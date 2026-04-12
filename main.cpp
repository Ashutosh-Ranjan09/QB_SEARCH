#include<bits/stdc++.h>
#include <thread>
#include <mutex>
#include <condition_variable>// for putting threads to sleep/wakeup
#include <chrono>//time 
#include <curl/curl.h>//http req
using namespace std;

// --- Thread-Safe Queue  ---
template <typename T>
class SafeQueue {// to make in mutually exclusive etc
private:
    queue<T> q;
    mutex m;
    condition_variable cv;
    bool finished=false;
public:
    void push(T item) {
        lock_guard<mutex> lock(m);//locking queue//object creation to lock
        q.push(item);
        cv.notify_one();
    }// unlocked when scope is finished

    bool pop(T& item) {
        unique_lock<mutex> lock(m); //locks but allows cv to unlock it temply
        cv.wait(lock, [this] { return !q.empty() || finished; });// to check whether to sleep or wakeup
        if (q.empty()) return false;//reaches here only if m i slocked
        item = q.front();// pass by reference
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

// --- Worker Function  ---
void worker(SafeQueue<string>& url_queue, vector<Result>& results, mutex& res_mutex) {
    // Each thread gets its own CURL handle to act as a connection pool [cite: 29]
    CURL* curl = curl_easy_init();
    if (!curl) return;

    // Enable TCP Keep-Alive for socket reuse [cite: 21]
    curl_easy_setopt(curl, CURLOPT_TCP_KEEPALIVE, 1L);
    // keep tcp alive and turn it on=1
    string url;
    while (url_queue.pop(url)) {
        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_NOBODY, 1L); // Just test connectivity for now

        auto start = chrono::high_resolution_clock::now();
        CURLcode res = curl_easy_perform(curl);// call the url
        auto end = chrono::high_resolution_clock::now();

        if (res == CURLE_OK) {
            long response_code;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);
            
            double elapsed = chrono::duration<double, milli>(end - start).count();
            
            lock_guard<mutex> lock(res_mutex);// locking result vector
            results.push_back({elapsed, response_code});
        }
    }
    curl_easy_cleanup(curl);
}

int main() {
    curl_global_init(CURL_GLOBAL_ALL);

    SafeQueue<string> url_queue;
    vector<Result> results;
    mutex res_mutex;
    
    int num_threads = thread::hardware_concurrency(); // although we can create more using using pthread directly
    // cout<<"NUM THREADS: "<<num_threads<<"\n";
    int total_requests = 1000; 

    // 1. Fill Queue with Solr Queries
    // A list of realistic search terms based on your Solr documents
    vector<string> search_terms = {
        "C++", "Python", "Operating", "Architecture", "Memory", 
        "competitive", "kernel", "TCP", "routing", "ingestion"
    };

    // Seed the random number generator
    srand(time(0)); 

    const char* env_p = std::getenv("API_URL");
    string base_url = env_p ? env_p : "http://localhost:3001/api";

    for (int i = 0; i < total_requests; ++i) {
        // Pick a random word from the list
        string random_word = search_terms[rand() % search_terms.size()];
        
        // Push the dynamic query to the Node.js server
        url_queue.push(base_url + "/search?q=" + random_word);
    }
    url_queue.set_finished();
    // all pushed
    // 2. Start Timing and Spawn Threads 
    cout << "Starting stress test with " << num_threads << " threads..." << endl;
    auto start_time = chrono::high_resolution_clock::now();

    vector<thread> workers;
    for (int i = 0; i < num_threads; ++i) {
        workers.emplace_back(worker, ref(url_queue), ref(results), ref(res_mutex));
    }
    //workers.push_back(thread(worker,ref(url_queue),ref..));
    for (auto& t : workers) t.join();

    auto end_time = chrono::high_resolution_clock::now();
    double total_duration = chrono::duration<double>(end_time - start_time).count();

    // 3. Calculate Baseline Metrics [cite: 30]

    if(results.size())
    {
        sort(results.begin(), results.end(), [](Result a, Result b) {
            return a.duration_ms < b.duration_ms;
        });

        double qps = results.size() / total_duration;
        double p50 = results[results.size() * 0.5].duration_ms;
        double p95 = results[results.size() * 0.95].duration_ms;

        cout << "--- Baseline Metrics ---" << endl;
        cout << "Total Requests: " << results.size() << endl;
        cout << "Total Time:     " << total_duration << " s" << endl;
        cout << "QPS:            " << qps << " req/s" << endl;
        cout << "p50 Latency:    " << p50 << " ms" << endl;
        cout << "p95 Latency:    " << p95 << " ms" << endl;
    }
    else
    {
        cout << "--- Error ---" << endl;
        cout << "All " << total_requests << " requests failed!" << endl;
        cout << "Is your Solr cluster currently running on ports 8983 and 8984?" << endl;
    }
    curl_global_cleanup();
    return 0;
}