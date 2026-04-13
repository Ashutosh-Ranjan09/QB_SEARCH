#include <bits/stdc++.h>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <curl/curl.h>
using namespace std;

// --- Thread-Safe Queue ---
template <typename T>
class SafeQueue {
private:
    queue<T> q;
    mutex m;
    condition_variable cv;
    bool finished = false;
public:
    void push(T item) {
        lock_guard<mutex> lock(m);
        q.push(item);
        cv.notify_one();
    }

    bool pop(T& item) {
        unique_lock<mutex> lock(m);
        cv.wait(lock, [this] { return !q.empty() || finished; });
        if (q.empty()) return false;
        item = q.front();
        q.pop();
        return true;
    }

    void set_finished() {
        lock_guard<mutex> lock(m);
        finished = true;
        cv.notify_all();
    }
};

// --- Statistics Storage ---
struct Result {
    double duration_ms;
    long http_code;
};

// --- Silencer Function ---
// This prevents libcurl from spamming the terminal with JSON or HTML error pages
size_t drop_output(void *contents, size_t size, size_t nmemb, void *userp) {
    return size * nmemb; 
}

// --- Worker Function ---
void worker(SafeQueue<string>& url_queue, vector<Result>& results, mutex& res_mutex) {
    CURL* curl = curl_easy_init();
    if (!curl) return;

    // Enable TCP Keep-Alive for socket reuse
    curl_easy_setopt(curl, CURLOPT_TCP_KEEPALIVE, 1L);
    
    // Tell libcurl to silently drop the response body using our function above
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, drop_output);

    string url;
    while (url_queue.pop(url)) {
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());

        auto start = chrono::high_resolution_clock::now();
        CURLcode res = curl_easy_perform(curl);
        auto end = chrono::high_resolution_clock::now();

        if (res == CURLE_OK) {
            long response_code;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
            
            double elapsed = chrono::duration<double, milli>(end - start).count();
            
            lock_guard<mutex> lock(res_mutex);
            results.push_back({elapsed, response_code});
        }
    }
    curl_easy_cleanup(curl);
}

// --- Experiment Runner ---
void run_experiment(const string& experiment_name, const string& target_url, int total_requests, int num_threads) {
    SafeQueue<string> url_queue;
    vector<Result> results;
    mutex res_mutex;

    vector<string> search_terms = {
        "C++", "Python", "Operating", "Architecture", "Memory", 
        "competitive", "kernel", "TCP", "routing", "ingestion"
    };

    // 1. Fill Queue
    for (int i = 0; i < total_requests; ++i) {
        string random_word = search_terms[rand() % search_terms.size()];
        url_queue.push(target_url + random_word);
    }
    url_queue.set_finished();

    cout << "\n======================================================\n";
    cout << "🚀 STARTING: " << experiment_name << "\n";
    cout << "🔗 Target:   " << target_url << "\n";
    cout << "======================================================\n";

    // 2. Start Timing and Spawn Threads
    auto start_time = chrono::high_resolution_clock::now();

    vector<thread> workers;
    for (int i = 0; i < num_threads; ++i) {
        workers.emplace_back(worker, ref(url_queue), ref(results), ref(res_mutex));
    }
    for (auto& t : workers) t.join();

    auto end_time = chrono::high_resolution_clock::now();
    double total_duration = chrono::duration<double>(end_time - start_time).count();

    // 3. Calculate Metrics
    if (!results.empty()) {
        sort(results.begin(), results.end(), [](Result a, Result b) {
            return a.duration_ms < b.duration_ms;
        });

        double qps = results.size() / total_duration;
        double p50 = results[results.size() * 0.5].duration_ms;
        double p95 = results[results.size() * 0.95].duration_ms;
        
        // Count HTTP 429s (Rate Limited) to show the middleware working
        int rate_limited_count = 0;
        for (const auto& r : results) {
            if (r.http_code == 429) rate_limited_count++;
        }

        cout << "--- Results ---\n";
        cout << "Total Requests: " << results.size() << " (" << rate_limited_count << " Rate Limited)\n";
        cout << "Total Time:     " << total_duration << " s\n";
        cout << "QPS:            " << qps << " req/s\n";
        cout << "p50 Latency:    " << p50 << " ms\n";
        cout << "p95 Latency:    " << p95 << " ms\n";
    } else {
        cout << "--- Error ---\n";
        cout << "All requests failed! Is the target server running?\n";
    }
}

int main() {
    curl_global_init(CURL_GLOBAL_ALL);
    srand(time(0));

    int num_threads = thread::hardware_concurrency();
    int total_requests = 1000; 

    // === EXPERIMENT A: UNPROTECTED SOLR ===
    // Hits Solr directly, skipping Node.js
    string solr_url = "http://localhost:8983/solr/qb_collection/select?q=";
    run_experiment("EXPERIMENT A: Unprotected Baseline", solr_url, total_requests, num_threads);

    // Let the network breathe so we don't exhaust TCP ports (TIME_WAIT)
    cout << "\n[Sleeping 3 seconds before next test...]\n";
    this_thread::sleep_for(chrono::seconds(3));

    // === EXPERIMENT B: PROTECTED MIDDLEWARE ===
    // Hits your Express API with Redis Caching and Rate Limiting
    string nodejs_url = "http://localhost:3001/api/search?q=";
    run_experiment("EXPERIMENT B: Protected Middleware", nodejs_url, total_requests, num_threads);

    curl_global_cleanup();
    cout << "\n✅ Testing Complete.\n";
    return 0;
}