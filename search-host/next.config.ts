import type { NextConfig } from 'next';

// Cloudflare Pages 로컬 개발 환경 설정
// top-level await 대신 IIFE로 감싸 호환성 확보
if (process.env.NODE_ENV === 'development') {
  void (async () => {
    const { setupDevPlatform } = await import('@cloudflare/next-on-pages/next-dev');
    await setupDevPlatform();
  })();
}

const nextConfig: NextConfig = {
  // Cloudflare Pages 배포를 위한 설정
};

export default nextConfig;
