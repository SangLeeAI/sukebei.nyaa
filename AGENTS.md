# 에이전트 안내

이 저장소(`/home/slime/projects/nyaa`)에서만 작업하세요. 클라우드 VM이나 다른 워크스페이스에 앱을 복사하지 마세요.

- UI 문구는 한국어로 유지합니다.
- 부팅·환경 훅에서 `git pull` 하지 마세요. 로컬 수정이 덮이지 않게 이 트리에서만 이어갑니다.
- `data/`(SQLite, 토렌트 사본)와 `.translate-cache.json`은 git에 넣지 않습니다.
- 의존성(`package-lock.json`)이 바뀌면 `npm install` 후 `npm run dev`를 다시 켜세요.
- 개발 서버: `npm run dev` → http://127.0.0.1:48621/
- 강제 푸시하지 마세요. 원격이 없으면 GitHub 저장소를 임의로 만들지 마세요.
