#!/usr/bin/env node
// Cloudflare KV CLI 도구
// 환경변수:
//   CLOUDFLARE_ACCOUNT_ID    - Cloudflare 계정 ID
//   CLOUDFLARE_API_TOKEN     - KV 읽기/쓰기 권한이 있는 API 토큰
//   CLOUDFLARE_KV_NAMESPACE_ID - KV 네임스페이스 ID

import { Command } from 'commander';
import { getValue, putValue, listKeys, deleteValue } from './client';

function getEnvConfig(): { accountId: string; apiToken: string; namespaceId: string } {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  const namespaceId = process.env['CLOUDFLARE_KV_NAMESPACE_ID'];

  const missing: string[] = [];
  if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (!apiToken) missing.push('CLOUDFLARE_API_TOKEN');
  if (!namespaceId) missing.push('CLOUDFLARE_KV_NAMESPACE_ID');

  if (missing.length > 0) {
    console.error(`Error: 다음 환경변수가 설정되지 않았습니다: ${missing.join(', ')}`);
    process.exit(1);
  }

  return { accountId: accountId!, apiToken: apiToken!, namespaceId: namespaceId! };
}

const program = new Command();

program
  .name('cf-kv')
  .description('Cloudflare KV REST API CLI 도구')
  .version('0.1.0');

program
  .command('get <key>')
  .description('KV에서 키 값을 읽어 출력합니다')
  .action(async (key: string) => {
    const { accountId, apiToken, namespaceId } = getEnvConfig();
    try {
      const value = await getValue(accountId, apiToken, namespaceId, key);
      if (value === null) {
        console.error(`키를 찾을 수 없습니다: ${key}`);
        process.exit(1);
      }
      console.log(value);
    } catch (err) {
      console.error(`오류: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('put <key> <value>')
  .description('KV에 키/값을 저장합니다')
  .action(async (key: string, value: string) => {
    const { accountId, apiToken, namespaceId } = getEnvConfig();
    try {
      await putValue(accountId, apiToken, namespaceId, key, value);
      console.log(`저장 완료: ${key}`);
    } catch (err) {
      console.error(`오류: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('KV 네임스페이스의 모든 키 목록을 출력합니다')
  .action(async () => {
    const { accountId, apiToken, namespaceId } = getEnvConfig();
    try {
      const keys = await listKeys(accountId, apiToken, namespaceId);
      if (keys.length === 0) {
        console.log('(키 없음)');
      } else {
        keys.forEach((k) => console.log(k));
      }
    } catch (err) {
      console.error(`오류: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('delete <key>')
  .description('KV에서 키를 삭제합니다')
  .action(async (key: string) => {
    const { accountId, apiToken, namespaceId } = getEnvConfig();
    try {
      await deleteValue(accountId, apiToken, namespaceId, key);
      console.log(`삭제 완료: ${key}`);
    } catch (err) {
      console.error(`오류: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parse();
