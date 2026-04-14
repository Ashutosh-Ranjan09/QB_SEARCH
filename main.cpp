#include <bits/stdc++.h>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <fstream>
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
size_t drop_output(void *contents, size_t size, size_t nmemb, void *userp) {
    return size * nmemb; 
}

// --- Worker Function ---
void worker(SafeQueue<string>& url_queue, vector<Result>& results, mutex& res_mutex) {
    CURL* curl = curl_easy_init();
    if (!curl) return;

    // Enable TCP Keep-Alive for socket reuse
    curl_easy_setopt(curl, CURLOPT_TCP_KEEPALIVE, 1L);
    
    // Tell libcurl to silently drop the response body
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
void run_experiment(const string& experiment_name, const string& target_url, int total_requests, int num_threads, ofstream& csv_file) {
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

    cout << "Running " << experiment_name << " with " << total_requests << " requests...\n";

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
        
        // Count HTTP 429s (Rate Limited) or 500s (Server Error)
        int failed_count = 0;
        for (const auto& r : results) {
            if (r.http_code == 429 || r.http_code >= 500) failed_count++;
        }
        
        // Calculate true success rate percentage
        double success_rate = ((double)(results.size() - failed_count) / total_requests) * 100.0;

        // WRITE TO CSV
        csv_file << experiment_name << "," 
                 << num_threads << "," 
                 << qps << "," 
                 << p50 << "," 
                 << p95 << "," 
                 << success_rate << "\n";

    } else {
        cout << "All requests failed for " << experiment_name << "!\n";
    }
}

int main() {
    curl_global_init(CURL_GLOBAL_ALL);
    srand(time(0));

    int num_threads = thread::hardware_concurrency();
    
    // Test volumes for plotting
    vector<int> load_volumes = {500, 1000, 2500, 5000, 10000, 15000}; 

    string solr_url = "http://localhost:8983/solr/qb_collection/select?q=";
    string nodejs_url = "http://localhost:3001/api/search?q=";

    // Open CSV file and write the header row
    ofstream csv_file("combined_benchmark_results.csv");
    csv_file << "Experiment,Concurrency_Level,QPS,p50_Latency_ms,p95_Latency_ms,Success_Rate\n";

    cout << "\n======================================================\n";
    cout << "🚀 STARTING AUTOMATED LOAD TEST SUITE\n";
    cout << "======================================================\n";

    // Loop through each load volume to gather plot data
    for (int total_requests : load_volumes) {
        run_experiment("Unprotected Baseline", solr_url, total_requests, num_threads, csv_file);
        
        // Let the network breathe
        this_thread::sleep_for(chrono::seconds(2));

        run_experiment("Protected Middleware", nodejs_url, total_requests, num_threads, csv_file);
        
        this_thread::sleep_for(chrono::seconds(2));
    }

    csv_file.close();
    curl_global_cleanup();
    
    cout << "\n✅ Testing Complete. Results saved to 'combined_benchmark_results.csv'.\n";
    return 0;
}