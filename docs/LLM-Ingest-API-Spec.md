# LLM Ingest API Specification

**Primary technical source:** IAB Tech Lab — *LLMs and AI Agents Integration Framework* (June 4, 2025), PDF.  
**Local reference:** `docs/LLMs-and-AI-Agents-Integration.pdf`

This document summarizes the **request/response protocol** for the LLM Ingest API as defined in the IAB framework. Two variants are specified: **Publisher** (with pricing/bidding) and **Brand** (without pricing). The **detailed endpoint and payload definitions** in this spec are taken from the PDF; IAB has not published a separate technical API spec document or GitHub repository for the LLM Ingest API. Future releases are expected under the CoMP standard (see [§6 Official IAB references](#6-official-iab-references)).

---

## 1. Overview

- **Purpose:** Enable AI operators (LLMs, AI agents) to query publisher or brand content via natural language prompts; return content or content paths (URLs) with optional billing.
- **Authentication:** Partner Key (API Key) in header `X-Partner-Key`. Registration typically required via a business relationship (e.g. contract).
- **Transport:** All endpoints use **HTTPS**. Request/response bodies are **application/json** unless noted.

---

## 2. Publisher LLM Ingest API

### 2.1 Authentication

| Item | Value |
|------|--------|
| Method | Partner Key (API Key) |
| Header | `X-Partner-Key: <your-partner-key>` |
| Registration | Partner key obtained via publisher registration (e.g. `/llm-ingest/register`). Business relationship required. |
| Scopes | `query_content`, `bid_content` |
| Rate limits | 100 requests/minute; 10,000 requests/day |
| Invalid/missing key | **401 Unauthorized** |

### 2.2 Endpoints

| # | Endpoint | URL | Method | Description |
|---|----------|-----|--------|-------------|
| 1 | **Info** | `/info` | GET | Metadata: pricing, content types, access rules. Optional auth for public discovery. |
| 2 | **Query** | `/query` | POST | Submit prompt/query; receive content or URLs and billing info. |
| 3 | **Bidding** | `/bid` | POST | Submit bid for premium/exclusive content. |
| 4 | **Logging** | `/log` | POST | Submit query logs for billing verification (optional per publisher). |

Base path example: `https://publisher.com/api/llm-ingest/v1`.

---

### 2.3 Info Endpoint (Discovery)

**Request**

- **URL:** `/info`
- **Method:** `GET`
- **Headers:** `X-Partner-Key` optional (for public discovery)

**Response**

- **200 OK:** Success.
- **401 Unauthorized:** Invalid or missing partner key (if required).

**Response body (application/json)**

```json
{
  "api_version": "1.0",
  "publisher": {
    "name": "string",
    "id": "string",
    "contact": "string"
  },
  "authentication": {
    "method": "partner_key",
    "registration_url": "string"
  },
  "pricing": {
    "currency": "string",
    "per_query_rate": number,
    "content_rates": [
      {
        "content_type": "string",
        "rate": number,
        "description": "string"
      }
    ],
    "subscriptions": [
      {
        "plan_id": "string",
        "name": "string",
        "cost": number,
        "queries": number,
        "period": "string",
        "description": "string"
      }
    ],
    "dynamic_pricing": {
      "enabled": boolean,
      "bidding_endpoint": "string",
      "min_bid": number
    }
  },
  "content": {
    "categories": ["string"],
    "formats": ["string"],
    "query_endpoint": "string"
  },
  "logging": {
    "endpoint": "string",
    "required_fields": ["string"]
  },
  "terms": {
    "url": "string",
    "last_updated": "string"
  }
}
```

---

### 2.4 Query Endpoint

**Request**

- **URL:** `/query`
- **Method:** `POST`
- **Headers:** `X-Partner-Key` (required), `Content-Type: application/json`

**Request body (application/json)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | Yes | User prompt or search query. |
| `content_type` | string[] | No | Desired content types (e.g. `["article","report"]`). |
| `format` | string | No | Response format (e.g. `"json"`, `"pdf"`, `"html"`). Default: `"json"`. |
| `max_results` | integer | No | Max results (1–10). Default: 5. |
| `context` | object | No | Optional metadata: `user_location`, `language`. |

**Response**

- **200 OK:** Query processed successfully.
- **400 Bad Request:** Invalid query or parameters.
- **401 Unauthorized:** Invalid or missing partner key.
- **429 Too Many Requests:** Rate limit exceeded.

**Response body (200, application/json)**

```json
{
  "status": "success",
  "query_id": "string",
  "results": [
    {
      "content_id": "string",
      "title": "string",
      "content": "string",
      "url": "string",
      "cost": number,
      "content_type": "string",
      "format": "string"
    }
  ],
  "total_cost": number,
  "billing_id": "string"
}
```

- `content`: Full content when small (e.g. article text); omitted for large content.
- `url`: Secure, time-limited URL for large content (e.g. PDFs).
- `cost`: Cost per result (e.g. USD).
- `total_cost`: Sum of costs for all results.
- `billing_id`: Unique ID for billing.
- **content_id:** Content owner–managed ID for the item (source of truth for the content).

---

### 2.5 Bidding Endpoint

**Request**

- **URL:** `/bid`
- **Method:** `POST`
- **Headers:** `X-Partner-Key` (required), `Content-Type: application/json`

**Request body (application/json)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content_id` | string | Yes | ID of desired content. |
| `bid_amount` | number | Yes | Bid amount. |
| `currency` | string | No | Currency (e.g. `"USD"`). Default: `"USD"`. |
| `expires` | string | No | Bid expiration (ISO 8601). |

**Response**

- **200 OK:** Bid processed (accepted or rejected).
- **400 Bad Request:** Invalid content ID or bid.
- **401 Unauthorized:** Invalid or missing partner key.

**Response body — accepted (application/json)**

```json
{
  "status": "accepted",
  "content_id": "string",
  "final_cost": number,
  "access_url": "string",
  "expires": "string"
}
```

**Response body — rejected (application/json)**

```json
{
  "status": "rejected",
  "content_id": "string",
  "reason": "string"
}
```

---

### 2.6 Logging Endpoint

**Request**

- **URL:** `/log`
- **Method:** `POST`
- **Headers:** `X-Partner-Key` (required), `Content-Type: application/json`

**Request body (application/json)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `partner_key` | string | Yes | Partner key for authentication. |
| `query_id` | string | Yes | ID from query response. |
| `timestamp` | string | Yes | ISO 8601 (e.g. `"2025-05-27T16:51:00Z"`). |
| `content_ids` | string[] | Yes | List of content IDs returned. |
| `total_cost` | number | Yes | Total cost reported by client. |
| `signature` | string | No | HMAC-SHA256 for log integrity. |

**Response**

- **200 OK:** Log accepted.
- **400 Bad Request:** Invalid log data.
- **401 Unauthorized:** Invalid or missing partner key.

**Response body (application/json)**

```json
{
  "status": "accepted",
  "log_id": "string"
}
```

---

## 3. Brand LLM Ingest API

Same authentication and security as Publisher (Partner Key, rate limits, HTTPS). **No pricing or bidding**; focused on free, controlled content delivery to partners.

### 3.1 Endpoints

| # | Endpoint | URL | Method | Description |
|---|----------|-----|--------|-------------|
| 1 | **Info** | `/info` | GET | Metadata: content types, formats, access rules. |
| 2 | **Query** | `/query` | POST | Submit prompt/query; receive content or URLs. |
| 3 | **Logging** | `/log` | POST | Submit query logs for analytics (optional). |

### 3.2 Info Endpoint

**Request:** `GET /info`, `X-Partner-Key` optional.

**Response (200, application/json):** Same structure as Publisher Info but **no `pricing`**; top-level entity is `brand` instead of `publisher`:

```json
{
  "api_version": "1.0",
  "brand": {
    "name": "string",
    "id": "string",
    "contact": "string"
  },
  "authentication": { "method": "partner_key", "registration_url": "string" },
  "content": {
    "categories": ["string"],
    "formats": ["string"],
    "query_endpoint": "string"
  },
  "logging": { "endpoint": "string", "required_fields": ["string"] },
  "terms": { "url": "string", "last_updated": "string" }
}
```

### 3.3 Query Endpoint

**Request:** Same as Publisher Query (`POST /query`, body: `query`, optional `content_type`, `format`, `max_results`, `context`).

**Response (200, application/json):** Same as Publisher Query but **no `cost`, `total_cost`, or `billing_id`** in response:

```json
{
  "status": "success",
  "query_id": "string",
  "results": [
    {
      "content_id": "string",
      "title": "string",
      "content": "string",
      "url": "string",
      "content_type": "string",
      "format": "string"
    }
  ]
}
```

**content_id** remains the content owner–managed ID for each result.

### 3.4 Logging Endpoint

**Request:** `POST /log`, body: `partner_key`, `query_id`, `timestamp`, `content_ids` (no `total_cost` or `signature` in Brand variant).

**Response:** Same as Publisher Logging (`status`, `log_id`).

---

## 4. Error Responses (Publisher & Brand)

**Format:** `application/json`

```json
{
  "error": "string",
  "code": integer,
  "details": "string"
}
```

**Common codes**

| HTTP | code | error (example) |
|------|------|------------------|
| 401 | 401 | Invalid partner key |
| 429 | 429 | Rate limit exceeded |
| 400 | 400 | Invalid query |

---

## 5. Summary Table

| Endpoint | Publisher | Brand | Method | Auth |
|----------|-----------|-------|--------|------|
| Info | `/info` | `/info` | GET | Optional |
| Query | `/query` | `/query` | POST | Required |
| Bidding | `/bid` | — | POST | Required |
| Logging | `/log` | `/log` | POST | Required |

**content_id:** In both Publisher and Brand Query responses, each result includes a **content_id** that is the **content owner–managed ID** for that item (used for billing, logging, and bidding references).

---

## 6. Official IAB references

The following are the official IAB sources for the LLM Ingest API and the broader CoMP initiative. **No separate GitHub repository** exists for the LLM Ingest API specification; the request/response protocol is defined in the framework PDF.

| Resource | URL | Notes |
|----------|-----|--------|
| **LLMs and AI Agents Integration** (framework PDF) | [iabtechlab.com/wp-content/uploads/2025/06/LLMs-and-AI-Agents-Integration.pdf](https://iabtechlab.com/wp-content/uploads/2025/06/LLMs-and-AI-Agents-Integration.pdf) | **Authoritative source** for API endpoints, request/response bodies, and examples (Publisher & Brand LLM Ingest API). Released June 4, 2025. |
| **LLM Content Ingest API Initiative** | [iabtechlab.com/standards/llm-framework/](https://iabtechlab.com/standards/llm-framework/) | Initiative overview; states that releases will appear under the CoMP standard. Last updated June 4, 2025. |
| **CoMP (Content Monetization Protocols) Initiative** | [iabtechlab.com/standards/comp-content-monetization-protocols-initiative/](https://iabtechlab.com/standards/comp-content-monetization-protocols-initiative/) | CoMP is the umbrella for the LLM Ingest API work. Initial release and publisher guidance expected **March–April 2026**. |
| **IAB Tech Lab LLM, Content Ingest API Overview** | [iabtechlab.com/standards/iab-tech-lab-llm-content-ingest-api-overview/](https://iabtechlab.com/standards/iab-tech-lab-llm-content-ingest-api-overview/) | Overview page with download link to the framework PDF. |
| **CoMP Info Sheet** (Jan 2026) | [IAB-Tech-Lab-CoMP-Info-Sheet-Jan-2026.pdf](https://iabtechlab.com/wp-content/uploads/2026/02/IAB-Tech-Lab-CoMP-Info-Sheet-Jan-2026.pdf) | High-level CoMP value proposition (tokenization, discovery, licensing). No API request/response details; protocol details remain in the framework PDF. |
| **Content Monetization Protocols (CoMP) for AI Working Group** | [iabtechlab.com/working-groups/content-monetization-protocols-comp-for-ai-working-group/](https://iabtechlab.com/working-groups/content-monetization-protocols-comp-for-ai-working-group/) | Working group that develops the standards. Join: techlab@iabtechlab.com. |

**GitHub:** IAB Tech Lab’s [GitHub organization](https://github.com/IABTechLab) does not currently host a repository for the LLM Ingest API or CoMP API specification. The repository `IABTechLab/cmp` is the legacy DigiTrust CMP (deprecated), not the LLM/CoMP for AI.

**Feedback:** IAB requests feedback at [support@iabtechlab.com](mailto:support@iabtechlab.com).
