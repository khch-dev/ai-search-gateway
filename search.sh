#!/bin/bash

ACCOUNT_ID=7ba38cba70a2f73b6096ce0fa0f38f64
API_TOKEN=ZBjkFQVp9cqswyEYF9vqxzPAOXVDtehgRDPSA5uA
AUTORAG_NAME=crimson-shadow-a101


curl -X POST "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/autorag/rags/${AUTORAG_NAME}/search" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
          "query": "NHN"
      }'

