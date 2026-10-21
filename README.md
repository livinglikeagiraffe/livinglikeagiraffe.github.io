# Living Like a Giraffe

기린과 함께 초원을 돌아다니며 ㅊㅊㅊ 운동회와 멘탈 사우나 프로젝트를 만나는 Three.js 웹사이트.

배포 주소: https://livinglikeagiraffe.github.io/

## 실행과 배포

```sh
npm ci
npm start
```

로컬: http://127.0.0.1:4173/

`npm run build`로 `dist/` 정적 사이트를 생성합니다. Node 서버는 로컬 개발용이며 호스팅 서버는 필요하지 않습니다. Three.js 의존 모듈, 실제 사용하는 모델/텍스처/미디어, 출처 파일만 배포합니다.

GitHub Pages: Settings → Pages → Source를 GitHub Actions로 설정하고, Actions → Publish GitHub Pages → Run workflow를 실행합니다. 배포 워크플로는 수동 실행으로 설정되어 있습니다.

## 조작

- 데스크톱: WASD/방향키 이동, Shift 달리기, R로 프로필 러그에 복귀.
- 모바일: 오른쪽 아래 조이스틱. 중앙 가까이는 걷기, 바깥쪽은 달리기.
- 프로젝트 근처: 프로젝트 보기 또는 E. 사진·영상 확대 및 좌우 넘기기 지원.
- 친구 기린 근처: 말 걸기. Esc/나가기로 쿼터뷰 복귀.
- 낮·노을·해질녘 변경 가능. 해질녘에는 상세 글만 다크 테마.

## 공개 전 최적화

배포 출력은 약 139 MiB이며, 사용하지 않는 원본/예전 텍스처/검수 스크린샷은 제외됩니다. 잔디 텍스처 19.85 → 3.51 MiB, 주 기린 GLB 18.13 → 10.18 MiB. 모델 형태·스킨·애니메이션 데이터는 유지합니다. 모바일 픽셀 비율 상한 1.5, 그림자 1024px을 적용합니다. 갤러리 이미지는 지연 로딩하고 영상은 보일 때만 음소거로 재생합니다.

`python3 scripts/optimize-assets.py`는 Pillow가 있는 개발 환경에서 선택적으로 재실행할 수 있습니다. 원본은 최초 실행 시 `.source-assets/`에 보관하며 Git/배포에는 포함하지 않습니다. 일반 빌드에는 Python이 필요하지 않습니다.

## 출처와 권리

[전체 에셋 출처](ASSETS.md) · [웹 크레딧](https://livinglikeagiraffe.github.io/credits.html)

3D 에셋과 글꼴은 각각의 원본 라이선스를 따릅니다. 팀 사진·영상·로고 및 프로젝트 글은 해당 권리자에게 귀속됩니다. 사이트 전체에 일괄적인 오픈소스 라이선스를 부여하지 않습니다.
