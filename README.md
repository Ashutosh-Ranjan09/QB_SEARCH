# QBSearch (QuadBase Search)

![System Status](https://img.shields.io/badge/status-active-brightgreen)
![Tech Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20Solr%20%7C%20Redis%20%7C%20C++-blue)
![License](https://img.shields.io/badge/license-MIT-blue)

A highly scalable, extreme-throughput text search engine optimized for large document corpora (like academic papers). Built as a fully decoupled, multi-tiered microservice architecture focusing on distributed consensus, aggressive transient caching, and network resilience.

## 🌟 Key Features

- **Distributed Search Core:** Uses **Apache Solr** deployed in SolrCloud mode, orchestrated by a 3-node **ZooKeeper** ensemble to guarantee high availability, partition tolerance, and automatic leader election.
- **Query-Optimization Middleware:** A **Node.js** API Gateway that intercepts, sanitizes, and rewrites raw queries using Solr’s eDisMax parser. Includes dynamic phrase boosting, author-format recognition, and typo tolerance (fuzzy matching).
- **Transient Memory Tier:** Leverages **Redis** to hash query dimensions and cache search results. This achieves sub-millisecond, $O(1)$ lookups for repeating traffic, drastically reducing Lucene indexing evaluations and dropping overall tail latencies (p95).
- **Hostile Traffic Insulation:** Built-in IP-level rate-limiting (`express-rate-limit`) mitigates aggressive bot scraping algorithms and shields the Solr cores from deliberate DDoS saturation.
- **Multithreaded Benchmark Testing:** Includes a bespoke **C++** multithreaded benchmarking frame using `libcurl`. It enforces HTTP Keep-Alive connections to circumvent OS-level ephemeral port exhaustion while stress testing logical system boundaries.
- **Batched Asynchronous Ingestion:** A **Python** tool designed to ingest massive datasets sequentially by packing documents into HTTP batches, avoiding JVM garbage collection freezes.

## 🏗️ Architecture Stack

- **Storage & Search Engine:** Apache Solr (v10.0), ZooKeeper (v3.8)
- **API Gateway (Middleware):** Node.js, Express
- **Caching Layer:** Redis (v7)
- **Source of Truth (RDBMS):** PostgreSQL (Neon) for secure JWT rotation and metadata storage.
- **Frontend UI:** Next.js (React)
- **Deployment:** Docker & Docker Compose

## 🚀 Getting Started

### Prerequisites
Make sure you have [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) installed. 

### 1. Boot up the Infrastructure
The entire clustered backend, middleware, and frontend can be spun up through the defined container orchestrator:
```bash
docker-compose up --build -d
```
*Note: Upon initial startup, Solr will wait for Zookeeper quorum to form. A custom init script automatically provisions the 2-shard, 2-replica `qb_collection` index.*

### 2. Ingest Data (Optional)
To populate the Solr index with research datasets, use the built-in python ingestion script:
```bash
pip install requests
python3 ingest.py
```

### 3. Run Benchmark (C++ Stress Test)
Compile and trigger the native multithreaded traffic generator to witness the difference between unmitigated search requests and Redis-cached pathways:
```bash
g++ main.cpp -lcurl -lpthread -O3 -o load_tester
./load_tester
```

## 📬 Interaction Pathways

* **Frontend:** `http://localhost:3000`
* **API Gateway:** `http://localhost:3001`
* **Solr Node 1 Admin UI:** `http://localhost:8983/solr/`
* **Solr Node 2 Admin UI:** `http://localhost:8984/solr/`

## 📊 Performance Benchmarks

The system achieves:
- **Baseline (Direct Solr):** ~2,000-5,000 QPS depending on query complexity
- **With Redis Cache:** ~8,000-15,000 QPS for cached queries (80%+ hit rate typical)
- **p50 Latency:** 5-15ms from middleware
- **p95 Latency:** 25-60ms under normal load
- **Success Rate:** >99.5% with rate-limiting enabled

Run `./load_tester` to generate fresh benchmarks with your exact infrastructure.

## 🔍 Design Rationale

- **Microservices:** Each tier (search, cache, gateway) can scale independently, enabling targeted optimization without affecting other components.
- **Redis Caching:** Reduces computational load on Solr JVM, trading memory for latency reduction. Particularly effective for repetitive query patterns.
- **ZooKeeper:** Provides automatic failover and ensures read consistency across shard replicas, eliminating single points of failure.
- **C++ Benchmarking:** Native threading and libcurl provide fair performance baselines without garbage collector overhead, enabling accurate system characterization.
- **Rate-Limiting:** Protects the search cluster from malicious traffic and resource exhaustion, ensuring stable performance for legitimate users.

---

### Project Authors
* **Aryan Yadav** (23CS10003)
* **Ashutosh Ranjan** (23CS10004)
* **Mayank Modi** (23CS10089)
* **Aditya Singh Tomar** (23CS30001)

