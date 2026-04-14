import requests
import json

# The Solr update endpoint for your specific collection
# The "?commit=true" tells Solr to save the data immediately so we can search it
SOLR_URL = "http://localhost:9983/solr/qb_collection/update?commit=true"

# Sample dataset to test our pipeline
# We use standard keys like 'id', 'title', and 'content' 
documents = [
    {
        "id": "1", 
        "title": "Advanced C++ Techniques", 
        "content": "Exploring memory management and competitive programming strategies in C++."
    },
    {
        "id": "2", 
        "title": "Python Data Pipelines", 
        "content": "Using the requests library in Python to build efficient data ingestion pipelines."
    },
    {
        "id": "3", 
        "title": "Modern Operating Systems", 
        "content": "Understanding kernel architecture, process scheduling, and memory allocation."
    },
    {
        "id": "4", 
        "title": "Internet Architecture", 
        "content": "A deep dive into distributed network protocols, TCP/IP, and routing."
    }
]

def ingest_data():
    print(f"Attempting to ingest {len(documents)} documents into Solr...")
    
    # Solr expects the data to be in JSON format
    headers = {"Content-Type": "application/json"}
    
    try:
        # Send the POST request to Solr
        response = requests.post(SOLR_URL, data=json.dumps(documents), headers=headers)
        
        # Check if it was successful
        if response.status_code == 200:
            print("Success! Documents have been added to the qb_collection.")
        else:
            print(f"Failed to ingest. HTTP Status: {response.status_code}")
            print(f"Error details: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to Solr. Is the cluster running on port 8983?")

if __name__ == "__main__":
    ingest_data()