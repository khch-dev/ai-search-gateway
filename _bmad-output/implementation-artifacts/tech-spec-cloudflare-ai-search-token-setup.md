---
title: 'Cloudflare AI Search Token Setup Script'
slug: 'cloudflare-ai-search-token-setup'
created: '2026-02-12'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Bash', 'curl', 'jq (optional)']
files_to_modify: []
code_patterns: ['Clean slate - no existing scripts; ACCOUNT_ID read from file']
test_patterns: ['Manual run per step; optional dry-run for output-only verification']
---

# Tech-Spec: Cloudflare AI Search Token Setup Script

**Created:** 2026-02-12

## Overview

### Problem Statement

Cloudflare AI Search를 사용하려면 가이드(https://developers.cloudflare.com/ai-search/get-started/api/)의 1~5단계를 순서대로 수행해야 한다. 수동 단계와 API 단계가 혼재되어 있어 누락·오입력 위험이 있고, 각 단계 결과 확인 후 다음 단계로 넘어가는 흐름이 필요하다.

### Solution

Bash 스크립트 하나가 1~5단계를 모두 관장한다. 수동 단계(1, 3)에서는 필요한 정보 설명과 함께 stdio로 입력을 받고, API 단계(2, 4, 5)는 curl 등으로 호출한 뒤 결과를 화면에 보여준다. 매 단계 종료 시 사용자가 "다음 단계" 진행을 승인할 때만 다음 단계로 진행한다. ACCOUNT_ID는 프로젝트 루트의 `ACCOUNT_ID.txt`에서 읽고, 5단계는 웹 크롤러 타입으로 사이트 URL과 sitemap 경로를 각각 입력받는다.

### Scope

**In Scope:**
- Bash 스크립트로 1~5단계 순차 수행
- 수동 단계(1, 3): 안내 문구 + stdio 입력
- API 단계(2, 4, 5): REST 호출 후 결과 출력
- 단계별 결과 표시 후 "다음 단계" 승인 시에만 진행
- ACCOUNT_ID는 `ACCOUNT_ID.txt`에서 읽기
- 5단계: web-crawler 타입, 크롤할 사이트 URL과 sitemap 경로를 각각 입력받기

**Out of Scope:**
- R2 버킷 타입 인스턴스 생성(5단계)
- 대시보드 자동화(브라우저 자동화 등)
- Bash 이외 언어 구현

## Context for Development

### Codebase Patterns

- **Confirmed Clean Slate**: Cloudflare·스크립트 관련 기존 코드 없음. 프로젝트 루트에 `ACCOUNT_ID.txt`(한 줄 계정 ID)만 존재.
- 스크립트 배치: 프로젝트 루트에 새 파일 생성(예: `setup-cloudflare-ai-search.sh`). `ACCOUNT_ID.txt`와 동일 디렉터리에서 읽도록 함.
- 레거시 제약 없음.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `ACCOUNT_ID.txt` | Cloudflare 계정 ID (스크립트에서 읽음) |
| [Cloudflare AI Search API - Get started](https://developers.cloudflare.com/ai-search/get-started/api/) | 1~5단계 절차 및 API 참조 |
| [Cloudflare API - Create token (user)](https://developers.cloudflare.com/api/operations/user-create-token) | 2단계 Service API Token 생성 |
| [Cloudflare API - AI Search tokens create](https://developers.cloudflare.com/api/operations/ai-search-tokens-create) | 4단계 Service token 등록 |
| [Cloudflare API - AI Search instances create](https://developers.cloudflare.com/api/operations/ai-search-instances-create) | 5단계 인스턴스 생성 (web-crawler 시 `source`, `source_params`) |

### Technical Decisions

- **언어**: Bash. `curl` 필수, `jq`는 JSON 파싱 편의용(없으면 grep/sed로 대체 가능).
- **입력**: 필요한 값은 설명 문구와 함께 `read`로 stdio 입력.
- **진행 제어**: 각 단계 끝에 "다음 단계로 진행할까요? (y/n)" 등으로 승인 후 다음 단계만 실행.
- **API 엔드포인트**  
  - 2단계: `POST https://api.cloudflare.com/client/v4/user/tokens` (Authorization: Bearer \<API_TOKEN\>). Body: name, policies(permission_groups: AI Search Index Engine, Workers R2 Storage Write). 응답: `result.id`, `result.value` → CF_API_ID, CF_API_KEY.  
  - 4단계: `POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai-search/tokens` (Authorization: Bearer \<AI_SEARCH_API_TOKEN\>). Body: cf_api_id, cf_api_key, name. 응답: `result.id` → TOKEN_ID.  
  - 5단계: `POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai-search/instances` (Authorization: Bearer \<AI_SEARCH_API_TOKEN\>). Body: id(인스턴스 id), token_id, type: "web-crawler", source: 도메인(사이트 URL에서 호스트 추출 또는 입력). sitemap 제한이 필요하면 `source_params`(예: path_include 등)는 API 문서에 따라 추가.
- **5단계 source**: 웹 크롤러는 `source`에 **동일 Cloudflare 계정에 온보딩된 도메인**만 허용. 사이트 URL 입력 시 호스트만 추출해 사용. sitemap 경로는 대시보드 문서상 "단일 sitemap URL 지정" 옵션이 있으므로, API에 해당 필드가 있으면 입력받아 전달하고 없으면 안내만 출력.

## Implementation Plan

### Tasks

- [x] Task 1: Create script skeleton and ACCOUNT_ID loading
  - File: `setup-cloudflare-ai-search.sh` (project root)
  - Action: Add shebang (`#!/usr/bin/env bash`), set `set -e` (or equivalent). Resolve script directory; read `ACCOUNT_ID` from `ACCOUNT_ID.txt` in same directory as script (or project root). If file missing or empty, exit with clear error. Define a function `confirm_next_step` that prints a message like "다음 단계로 진행할까요? (y/n)" and reads one character; only return success when user inputs y/Y; otherwise exit or re-prompt per product preference.
  - Notes: Script must be runnable from project root. Path to `ACCOUNT_ID.txt`: same dir as script or explicit project root.

- [x] Task 2: Implement Step 1 (manual – guide + stdin)
  - File: `setup-cloudflare-ai-search.sh`
  - Action: Print short instructions for creating an API token with "User > API Tokens > Edit" (token creation permission). Ask user to paste the token value. Prompt: e.g. "대시보드에서 발급한 API 토큰 값을 입력하세요 (Token Creator):". Read into `API_TOKEN`. Optionally echo back masked (e.g. first 4 + "..."). Call `confirm_next_step` before proceeding.
  - Notes: No API call. Output only what's needed so user can do the step in dashboard.

- [x] Task 3: Implement Step 2 (Service API Token creation)
  - File: `setup-cloudflare-ai-search.sh`
  - Action: Build JSON body for `POST https://api.cloudflare.com/client/v4/user/tokens`: name (e.g. "AI Search Service API Token"), policies with account resource and permission_groups `9e9b428a0bcd46fd80e580b46a69963c`, `bf7481a1826f439697cb59a20b22293e`. Call with `curl -s -X POST ... -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" --data @-` (or equivalent). Parse response: on success extract `result.id` → `CF_API_ID`, `result.value` → `CF_API_KEY` (use `jq` if available, else grep/sed). Print success message and display `id` (value should be shown only once and optionally masked). On API error, print response and exit. Call `confirm_next_step`.
  - Notes: User must have created token in Step 1. Store CF_API_ID and CF_API_KEY for steps 4 and 5.

- [x] Task 4: Implement Step 3 (manual – AI Search API token)
  - File: `setup-cloudflare-ai-search.sh`
  - Action: Print instructions for creating an API token with "Account > AI Search > Edit". Prompt: e.g. "대시보드에서 발급한 AI Search API 토큰 값을 입력하세요 (AI Search Manager):". Read into `AI_SEARCH_API_TOKEN`. Confirm (masked) and call `confirm_next_step`.
  - Notes: No API call.

- [x] Task 5: Implement Step 4 (Register service token with AI Search)
  - File: `setup-cloudflare-ai-search.sh`
  - Action: Build JSON body with `cf_api_id`, `cf_api_key`, `name`. POST to `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-search/tokens` with `Authorization: Bearer $AI_SEARCH_API_TOKEN`. Parse `result.id` → `TOKEN_ID`. Print result; on error print response and exit. Call `confirm_next_step`.
  - Notes: Uses ACCOUNT_ID from file, CF_API_ID/CF_API_KEY from Step 2.

- [x] Task 6: Implement Step 5 (Create web-crawler instance)
  - File: `setup-cloudflare-ai-search.sh`
  - Action: Prompt for "크롤할 사이트 URL (예: https://example.com):", read into `SITE_URL`. Prompt for "sitemap 경로 (예: /sitemap.xml 또는 전체 URL):", read into `SITEMAP_PATH`. Derive domain from SITE_URL (e.g. strip scheme and path). Prompt for instance id (e.g. "인스턴스 ID (영문/숫자, 예: my-web-rag):"), read into `INSTANCE_ID`. Build JSON: id, token_id (TOKEN_ID), type "web-crawler", source = derived domain. If API supports a sitemap parameter (e.g. in source_params), include it from SITEMAP_PATH; otherwise document in script output that user can set sitemap in dashboard. POST to `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-search/instances`. Print full response; on error print and exit. Call `confirm_next_step` or end with success message.
  - Notes: Domain must be onboarded to same Cloudflare account. Sitemap path may be path-only or full URL; normalize as needed for API.

- [x] Task 7: Add script header and usage
  - File: `setup-cloudflare-ai-search.sh`
  - Action: At top of file (after shebang), add brief comment describing the script (Cloudflare AI Search 1–5단계 순차 수행, 수동 단계는 안내 후 stdin 입력, 단계별 승인 후 진행). Ensure script is executable (`chmod +x` noted in README or docs).
  - Notes: No separate README required in spec; comment in script suffices unless project standard requires README.

### Acceptance Criteria

- [ ] AC 1: Given `ACCOUNT_ID.txt` exists in the same directory as the script (or project root) with one line (account ID), when the script is run, then it reads ACCOUNT_ID and proceeds to Step 1 without error.
- [ ] AC 2: Given `ACCOUNT_ID.txt` is missing or empty, when the script is run, then it exits with a clear error message and does not call any API.
- [ ] AC 3: Given the user is at Step 1, when the script prints instructions for creating a token with token-creation permission and prompts for the token value, then the user can paste the value via stdin and the script stores it and, after confirm_next_step (y), proceeds to Step 2.
- [ ] AC 4: Given valid API_TOKEN from Step 1, when Step 2 runs, then the script sends the correct POST to create the service token, parses CF_API_ID and CF_API_KEY from the response, prints a success message, and after confirm_next_step (y) proceeds to Step 3.
- [ ] AC 5: Given Step 2 returns an API error (e.g. 4xx/5xx or success: false), when the script handles the response, then it prints the error and exits without proceeding.
- [ ] AC 6: Given the user is at Step 3, when the script prints instructions for the AI Search Edit token and prompts for the token value, then the user can paste AI_SEARCH_API_TOKEN via stdin and, after confirm_next_step (y), the script proceeds to Step 4.
- [ ] AC 7: Given valid AI_SEARCH_API_TOKEN, CF_API_ID, CF_API_KEY, and ACCOUNT_ID, when Step 4 runs, then the script registers the service token with AI Search, parses TOKEN_ID, prints the result, and after confirm_next_step (y) proceeds to Step 5.
- [ ] AC 8: Given the user is at Step 5, when the script prompts for site URL, sitemap path, and instance id, then the user can enter them via stdin; the script derives the domain from the URL and creates a web-crawler instance with the correct payload and prints the API response; after confirm_next_step (y) or end, the script finishes successfully.
- [ ] AC 9: Given the user answers n/N to "다음 단계로 진행할까요?", when confirm_next_step runs, then the script exits (or re-prompts as specified) and does not proceed to the next step.
- [ ] AC 10: Given jq is not installed, when the script parses JSON (e.g. for result.id, result.value), then it still extracts required fields (e.g. via grep/sed) and continues, or documents that jq is required and exits with a clear message.

## Additional Context

### Dependencies

- Bash 4+ (or 3.x with no associative arrays if used).
- `curl`: required for all API calls.
- `jq`: optional; if absent, script must parse JSON with grep/sed or document requirement and exit.
- Cloudflare: R2 subscription and account with ability to create API tokens and AI Search instances; for web-crawler, the domain must be onboarded to the same account.
- No other project tasks or features depend on this script.

### Testing Strategy

- **Manual**: Run script from project root with real credentials; complete steps 1–5 in order; verify each step output and that next step runs only after y. Verify error behavior: missing ACCOUNT_ID.txt, invalid token, API error response.
- **No unit tests** required for this script unless project standard mandates; focus on manual path.
- **Optional**: A dry-run or debug mode that prints curl commands and request bodies without executing them, for safe verification of request shape.

### Notes

- **Risk**: Tokens (API_TOKEN, CF_API_KEY, AI_SEARCH_API_TOKEN) are sensitive; avoid logging full values; show value only once at creation if at all, otherwise masked.
- **Limitation**: Steps 1 and 3 require manual dashboard work; script cannot automate token creation in dashboard.
- **Sitemap**: If the AI Search instances API does not expose a sitemap URL field, script accepts sitemap path for user reference and documents that it can be set in dashboard (Parser options).
- **Future**: R2 bucket type could be added as an alternative branch in Step 5; out of scope for this spec.

## Review Notes

- Adversarial review completed.
- Findings: 10 total, 7 fixed (real), 3 skipped (noise/undecided).
- Resolution approach: Fix automatically (real only).
- Auto-fix applied: F1 dead code 제거, F2 INSTANCE_ID 검증·산정화, F3 ACCOUNT_ID 형식 경고, F4 curl 타임아웃, F5 jq 미설치 안내, F9 4단계 이미 등록 시 안내 메시지, F10 도메인 끝 점·공백 제거.
