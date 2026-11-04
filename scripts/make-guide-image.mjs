// 카카오 '이용 안내' 카드 썸네일(800×800) 만들기: node scripts/make-guide-image.mjs
// 문구를 바꾸면 lib/kakao.ts의 GUIDE_DESCRIPTION과 함께 고치고 다시 실행한다.
import sharp from "sharp";

const BRAND = "#1f6f68";
const INK = "#1f2a2e";
const SAND = "#f6f4ef";
const ACCENT = "#f4b183";

const items = [
  ["위치와 냄새 세기만 골라요", "문장은 쓰지 않아도 돼요"],
  ["지도에는 약 200m 단위로 보여요", "정확한 좌표는 바로 지워요"],
  ["30분 안에 다시 보내면 1건으로", "같은 곳 제보는 하나로 합쳐져요"],
  ["근처 1km 제보에 ‘저도 느꼈어요’", "버튼 하나로 함께 알려요"],
  ["대기질과 바람도 지도에서", "냄새가 퍼지는 쪽을 볼 수 있어요"],
  ["원인·책임은 판단하지 않아요", "몸이 불편하면 119에 전화하세요"],
];

const font = "Apple SD Gothic Neo, AppleSDGothicNeo, sans-serif";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const rowTop = 196;
const rowH = 98;
const rows = items
  .map(([title, sub], i) => {
    const y = rowTop + i * rowH;
    return `
  <g>
    <circle cx="78" cy="${y + 36}" r="30" fill="${BRAND}"/>
    <text x="78" y="${y + 47}" text-anchor="middle" font-family="${font}" font-size="32" font-weight="800" fill="#fff">${i + 1}</text>
    <text x="128" y="${y + 30}" font-family="${font}" font-size="36" font-weight="800" fill="${INK}">${esc(title)}</text>
    <text x="128" y="${y + 70}" font-family="${font}" font-size="28" font-weight="500" fill="#4a5659">${esc(sub)}</text>
  </g>`;
  })
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <rect width="800" height="800" fill="${SAND}"/>
  <rect width="800" height="160" fill="${BRAND}"/>
  <g transform="translate(40 40) scale(1.25)">
    <rect width="64" height="64" rx="17" fill="#ffffff" fill-opacity="0.14"/>
    <circle cx="45" cy="18" r="4" fill="${ACCENT}"/>
    <path d="M13 35c8 0 10-14 17-14s11 14 21 14" fill="none" stroke="${SAND}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M13 46h23c7 0 12-2 15-6" fill="none" stroke="${SAND}" stroke-width="4.5" stroke-linecap="round"/>
  </g>
  <text x="140" y="96" font-family="${font}" font-size="54" font-weight="800" fill="#ffffff">제주숨결봇 이용 안내</text>
  ${rows}
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile("public/brand/guide.png");
const meta = await sharp("public/brand/guide.png").metadata();
console.log(`public/brand/guide.png ${meta.width}×${meta.height}`);
