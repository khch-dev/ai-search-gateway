import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    // TypeScript 파일을 직접 resolve 가능하게 설정
    extensions: ['.ts', '.js'],
  },
});
