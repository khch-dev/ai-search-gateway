/** Host ↔ Gateway HTTP 요청/응답 로그 항목 (API 응답 헤더 X-Search-Log와 동일한 구조) */
export type GatewayLogEntry = {
  id: string;
  method: string;
  url: string;
  requestBody: string;
  responseStatus: number;
  responseBody: string;
  timestamp: string;
};
