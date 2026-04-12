import requests
import json
import os

# The Solr update endpoint for your specific collection
SOLR_URL = os.environ.get("SOLR_UPDATE_URL", "http://localhost:8983/solr/qb_collection/update?commit=true")

# Batching prevents us from overloading RAM or dropping HTTP connections
BATCH_SIZE = 500 

def ingest_jsonl_file(filepath):
    print(f"\n--- Starting ingestion for {filepath} ---")
    headers = {"Content-Type": "application/json"}
    batch = []
    
    with open(filepath, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            try:
                # Parse the single line of JSON
                paper = json.loads(line.strip())
                
                # Map the arXiv fields to our expected Solr document structure
                # We use .get() so the script doesn't crash if a paper is missing a field
                doc = {
                    "id": paper.get("id", f"unknown_id_{line_num}"),
                    "title": paper.get("title", "No Title Provided"),
                    "authors": paper.get("authors", "Unknown Author"),
                    "categories": paper.get("categories", "cs.UNKNOWN"),
                    "abstract": paper.get("abstract", ""),
                    "pdf_url": paper.get("pdf_url", ""),
                    "abs_url": paper.get("abs_url", "")
                }
                batch.append(doc)
                
                # When the batch hits 500, fire it off to Solr
                if len(batch) >= BATCH_SIZE:
                    try:
                        response = requests.post(SOLR_URL, data=json.dumps(batch), headers=headers)
                        if response.status_code == 200:
                            print(f"Successfully ingested {line_num} papers so far...")
                        else:
                            print(f"Error on batch at line {line_num}. HTTP Status: {response.status_code}")
                    except requests.exceptions.ConnectionError:
                        print("\nCRITICAL ERROR: Could not connect to Solr.")
                        print("Is the cluster running on port 8983? Aborting ingestion.")
                        return # Stop the script if Solr is down
                    
                    # Clear the batch list from RAM for the next 500
                    batch.clear() 
                    
            except json.JSONDecodeError:
                print(f"Skipping invalid JSON format on line {line_num}")
                
        # The loop is over. Send any remaining documents left in the final partial batch
        if len(batch) > 0:
            try:
                response = requests.post(SOLR_URL, data=json.dumps(batch), headers=headers)
                if response.status_code == 200:
                    print(f"Final batch sent successfully!")
            except requests.exceptions.ConnectionError:
                print("Error sending final batch: Could not connect to Solr.")
            
        print(f"Finished {filepath}! Total lines processed: {line_num}")

if __name__ == "__main__":
    # The exact files you downloaded for the QuadBase academic engine
    files_to_process = ["cs_ir_papers.jsonl", "cs_ne_papers.jsonl"]
    
    for file in files_to_process:
        if os.path.exists(file):
            ingest_jsonl_file(file)
        else:
            print(f"ERROR: Could not find '{file}' in the current directory.")
            print("Please ensure the Python script and the .jsonl files are in the same folder.")