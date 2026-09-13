# Nyaa

오늘 할 일을 적고 체크하는 작은 웹 앱입니다. Vite + React + TypeScript로 만들었고, 목록은 이 브라우저의 로컬 저장소에만 남습니다. 계정, 데이터베이스, 외부 서비스는 쓰지 않습니다.

## 로컬에서 실행

Node.js 20 이상이 필요합니다.

```bash
cd /home/slime/projects/nyaa
npm install
npm run dev
```

개발 서버는 `http://127.0.0.1:48621` 에서 켜집니다. Vite `server.open`이 켜져 있어, 실행하면 브라우저가 그 주소로 열립니다.

끝내려면 터미널에서 `Ctrl+C`를 누르세요.

## 스크립트

- `npm run dev` — 개발 서버 (127.0.0.1:48621, 브라우저 자동 실행)
- `npm run build` — 프로덕션 빌드
- `npm run preview` — 빌드 결과 미리보기
