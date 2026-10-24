# Nyaa

이 컴퓨터 전용 sukebei.nyaa.si 검색·다운로드 앱입니다. 클라우드 VM이 아니라 **이 트리에서만** 실행합니다.

- 경로: `/home/slime/projects/nyaa`
- 시작: `npm run dev`
- 주소: http://127.0.0.1:48621/
- 스택: Vite + React + TypeScript (Tailwind / shadcn)

검색은 브라우저가 sukebei를 직접 치지 않고, Vite 개발 서버가 공개 검색 페이지를 가져와 JSON으로 돌려줍니다. 계정은 없습니다.

## 로컬에서 실행

Node.js 20 이상이 필요합니다.

```bash
cd /home/slime/projects/nyaa
npm install
npm run dev
```

개발 서버는 `127.0.0.1:48621`에 고정되고(`strictPort`), 브라우저가 자동으로 열립니다. 끄려면 해당 터미널에서 `Ctrl+C`.

부팅 자동 시작은 없습니다. 후보가 있다면 사용자 systemd로 `npm run dev`만 켜고, **부팅 훅에서 `git pull` 하지 마세요.**

## 기본값

- **시작일:** 오늘 − 30일. 그날 로컬 0시부터 오늘까지. 빈 값·잘못된 값은 이 기본으로, 미래 날짜는 오늘로 고정.
- **시드:** 기본 3 이상만 표시. 빈 칸·잘못된 값도 3.

## 데이터 (git 제외)

SQLite: `/home/slime/projects/nyaa/data/nyaa.sqlite`

- `last_download`: 검색어별 마지막 받은 글(검색어·날짜·제목)
- `pending_qbittorrent`: 받았지만 qBittorrent에 아직 안 넣은 파일
- 토렌트 사본: `/home/slime/projects/nyaa/data/torrents/`
- 번역 캐시: `.translate-cache.json` (역시 git 제외)

## qBittorrent

체크한 `.torrent`을 받은 뒤 넣을지 묻습니다.

- **추가:** 이 컴퓨터 Web UI로 넣음. 기본 `http://127.0.0.1:8080`, `POST /api/v2/torrents/add`. 8081도 시도.
- **나중에:** 파일은 두고 `pending_qbittorrent`에 남김. 상단 **미추가 파일 다운로드**에서 다시 넣을 수 있음.

대체 환경 변수: `QBITTORRENT_URL`, `QBITTORRENT_USER`, `QBITTORRENT_PASSWORD` (`QBITTORRENT_PASS`도 동일). 미설정 시 사용자 `admin`, 비밀번호 `adminadmin`.

## 저장된 검색어

상단 **저장된 검색어 (N)** 은 `last_download` 행 수입니다. 페이지를 열 때, 토렌트를 받아 검색어가 저장될 때, 행을 지울 때 숫자가 바뀝니다. 없으면 `(0)`.

- 목록: 검색어·마지막 날짜·제목
- 행 클릭: 검색창과 시작일을 채우고 다시 검색
- 행별 **삭제:** 확인 후 그 검색어 행만 SQLite에서 제거

같은 검색어로 다시 찾으면 마지막 받은 글이 나오고, **이 날짜를 시작일로**를 누르면 시작일 칸에 그 날짜가 들어갑니다. 기록이 없으면 시작일은 오늘 − 30일.

## 검색·다운로드가 하는 일

1. `/api/search?q=...&since=YYYY-MM-DD` 가 sukebei 공개 검색(`f=0`, `c=0_0`, 최신순)을 1페이지부터 요청합니다.
2. 제목, 날짜, 용량, 시드/리치, 분류, 마그넷·토렌트 링크를 읽습니다.
3. 항목이 시작일보다 오래되면 멈추고, 페이지가 더 없으면 그 전에 멈춥니다.
4. 페이지 사이에 짧은 간격을 두어 공개 페이지를 과하게 두드리지 않습니다.
5. 목록이 오면 `/api/translate`가 제목(한글이 아닌 분류 포함)을 한국어로 옮깁니다. 키 없는 무료 번역을 이 컴퓨터에서 호출하고, 실패하면 원문을 그대로 둡니다. 원문은 제목 아래와 툴팁에 남습니다.
6. 공개 HTML에서 `tr.success`(신뢰 토렌트)이면 제목·원문을 `#5cb85c`로 표시합니다.
7. 각 결과 제목 옆에 체크박스가 있습니다. 기본은 선택되지 않습니다. **전체 선택** / **선택 해제**로 지금 보이는 목록을 다루고, **선택한 토렌트 받기**는 체크한 글만 받습니다. 선택이 없으면 버튼이 비활성입니다.
8. 받기는 sukebei의 `/download/{id}.torrent` 을 Vite 프록시가 대신 요청합니다. 마그넷은 쓰지 않습니다. 한 개면 `.torrent` 하나, 여러 개면 폴더 선택 창이 한 번만 뜨고 zip 없이 각각 저장합니다.

## Git

이 클론에는 **origin 원격이 없습니다.** GitHub 저장소를 새로 만들지 않았고, `gh`도 이 머신에 없습니다. 강제 푸시(`--force`)는 하지 마세요.

현재 작업 브랜치: `cursor/saved-query-count-5297`

## 스크립트

- `npm run dev` — 개발 서버 (http://127.0.0.1:48621/, 브라우저 자동 실행)
- `npm run build` — 프로덕션 빌드
- `npm run preview` — 빌드 결과 미리보기
- `npm run lint` — oxlint
