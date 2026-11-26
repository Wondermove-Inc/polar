# Polar

Polar는 Windows 11 x64용 개인 게임 런처다. Steam, Epic Games, Xbox에서 설치한 게임을 한 화면에서 선택한다. 홈은 키보드·마우스와 표준 매핑 게임패드를 지원한다. 설정에서 한국어와 English를 바꿀 수 있다.

## 설치와 사용

1. `Polar-1.0.0-rc.7-windows-x64-setup.exe`를 실행한다. 현재 사용자 계정에 설치된다. WebView2가 없는 PC에서는 설치 프로그램이 Microsoft 다운로드 페이지를 안내한다.
2. 시작 메뉴에서 **Polar**를 연다. 먼저 저장된 목록을 보여준 뒤 세 플랫폼을 각각 탐색한다. 방향키·패드 또는 홈 양쪽의 화살표로 마지막 게임까지 이동하고 확인 버튼이나 Enter로 실행한다. 설정의 **게임 라이브러리**에서 플랫폼별 결과와 진단을 확인한다.
3. Epic은 사용자별 설치 목록(`installations.jsonl`), 기존 중앙 설치 기록, `%ProgramFiles%\Epic Games`, 연결된 로컬 드라이브의 `Epic Games` 폴더를 확인한다. 예를 들어 `D:\Epic Games`와 `E:\Epic Games`는 자동으로 탐색한다. 다른 위치는 **설정 → 게임 라이브러리 → Epic 게임 폴더 추가**에서 설치 폴더나 그 상위 폴더를 지정한다. 게임 자체의 설치 기록(`.egstore`)도 확인한다. 설치 폴더를 발견했지만 실행 ID를 확인할 수 없으면 **라이브러리 → Epic Games**의 해당 폴더에 **바로가기 연결**이 표시된다. Epic 런처에서 그 게임의 바탕 화면 바로가기를 만든 뒤 연결한다. 폴더 연결을 해제해도 게임 파일은 보존된다.
4. 자동 감지되지 않는 게임은 **라이브러리 → 게임 추가**에서 기존 게임 바로가기 또는 등록 앱을 선택한다. 표시 이름과 플랫폼을 확인한 뒤 저장한다. 홈 또는 라이브러리에서 게임을 우클릭해 이름·표지·배경을 편집한다. 키보드는 Shift+F10, 표준 게임패드는 메뉴 버튼을 사용한다. 홈에서는 플레이 옆의 **•••**로도 연다. 직접 등록한 바로가기는 같은 편집기에서 변경·제거한다.
5. 게임 창과 실행 프로세스를 확인할 수 있으면 종료 시 선택한 타일로 복귀한다. 추가 실행기나 계정 확인 창에서 자동 추적이 어려우면 Alt+Tab으로 돌아올 수 있다. 바탕 화면 전환은 Polar를 최소화한다.
6. 업데이트할 때 Polar를 종료한 뒤 새 설치 파일을 실행한다. Windows의 설치된 앱에서 제거할 수 있다. 게임 파일, 세이브와 Polar의 사용자별 데이터는 설치 폴더와 분리된다.

## 화면 크기

앱을 열면 저장한 창 모드에서 Polar 마크가 나타난 뒤 약 0.9초 안에 홈으로 전환된다. 클릭하거나 키·게임패드 버튼을 눌러 건너뛸 수 있다. Polar 또는 Windows에서 모션 감소를 설정하면 홈이 바로 나타난다.

Polar는 1080p를 기준으로 큰 창에서 글자, 게임 아이콘, 버튼을 함께 키운다. 같은 크기의 16:9 화면에서 4K 전체 화면은 1080p와 비슷한 비율로 메뉴를 표시한다. 창 크기나 Windows 표시 배율을 바꾸면 자동으로 조정된다.

## 게임 배경

Steam 게임을 선택하면 Polar는 App ID로 해당 게임의 Steam 상점 스크린샷을 찾는다. PC Game Pass·Epic·수동 게임은 홈이나 라이브러리에서 해당 게임을 우클릭한 뒤 **게임 배경 → Steam에서 찾기**에서 설치한 에디션을 한 번 연결한다. 게임 이름을 수정해 검색할 수 있으며, 앱의 표시 언어로 검색한다. Steam에 없는 게임이나 다른 아트를 쓰고 싶은 게임은 같은 화면의 **이미지 주소로 배경 지정**을 열고 SteamGridDB의 **Hero 원본 이미지 주소**를 붙여 넣고 **이미지 적용**을 누른다. 원본 주소는 `https://cdn2.steamgriddb.com/hero/…` 형식이다. [SteamGridDB 게임 아트](https://www.steamgriddb.com/)

Polar는 1920×1080 이상인 가로 스크린샷을 선택한다. 적합한 스크린샷이 없으면 Steam 공식 라이브러리의 와이드 원본(1920×620 이상)을 확인한다. 선명한 원본은 화면의 실제 픽셀에 맞춰 표시하고, 여백에는 게임 이미지의 색을 부드럽게 채운다. 배경 사진 없이 표지만 있는 게임은 흐린 표지를 사용한다. Steam 표지가 로컬에 없으면 App ID로 공식 표지를 찾아 저장한다. 홈과 라이브러리에서 모든 플랫폼을 2:3 세로 타일로 표시한다. 정사각·가로 그림은 전체 원본을 중앙에 두고 주변을 같은 그림의 색으로 채운다. 우클릭 편집기의 **표지 사진 선택**으로 내 JPG·PNG·WebP 사진을 오프라인에서도 지정할 수 있다. [Steam 라이브러리 아트 규격](https://partner.steamgames.com/doc/store/assets/libraryassets?l=english)

**온라인 게임 배경**을 끄면 기존 로컬 배경과 다운로드한 캐시를 사용한다. 게임 편집기에서 상점을 검색할 때 선택한 게임 이름을 Steam에 보낸다. 다운로드한 이미지는 사용자별 캐시에 최대 128 MiB까지 보관하며, 공간이 부족하면 오래된 파일부터 정리한다. **기본 배경으로 복원**은 해당 게임에 지정한 연결을 해제한다.

## 개발과 검증

- Rust CLI와 플랫폼 탐색 회귀 시험은 `cargo test --workspace --locked`, UI 모델 시험은 `node --test tests/desktop-model.mjs`로 실행한다.
- Windows x64 MSVC 환경에서 Rust, Visual Studio C++ 빌드 도구, NSIS 3을 설치한 뒤 `.\packaging\build.ps1`을 실행하면 `target\dist`에 개인 설치 파일이 생성된다. CLI는 별도로 `cargo run -- list`로 실행한다.
- 브라우저 시험은 `desktop/ui`를 로컬 정적 서버로 연 뒤 해당 주소를 `POLAR_TEST_URL`에 지정하고 Playwright가 설치된 환경에서 `node tests/desktop-ui.cjs`, `node tests/desktop-flows.cjs`, `node tests/desktop-input.cjs`, `node tests/desktop-backdrops.cjs`, `node tests/desktop-readability.cjs`, `node tests/desktop-presentation.cjs`, `node tests/desktop-intro.cjs`, `node tests/desktop-editor.cjs`, `node tests/desktop-epic-pending.cjs`를 실행한다. 이 시험의 네이티브 명령 응답은 fixture다.
- Rust가 읽는 원본은 Steam 설치 기록과 로컬 앱 종류 캐시, Epic 설치 매니페스트 및 Windows 등록 앱·게임 메타데이터다. Xbox 등록 정보는 Windows 기본 PowerShell로 조회하고 로컬 드라이브의 XboxGames 또는 .GamingRoot가 지정한 설치 위치와 대조한다. Steam 캐시에서 게임 종류가 확인되지 않은 항목은 바로가기로 추가할 수 있다. 수동 항목의 원본은 Rust가 관리하고, UI 캐시와 즐겨찾기·언어는 사용자별 WebView 데이터에 저장한다.

아이콘 원본은 `desktop/ui/polar.svg`이다. 원본을 수정한 뒤 `uv run packaging/render-icon.py`로 Windows ICO를 갱신한다. `uv run tests/windows-icons.py <Polar.exe> <setup.exe> <Uninstall.exe>`는 세 실행 파일에 들어간 아이콘을 확인한다.

현재 배포 등급은 Windows 실기기 인수 전의 출시 후보이다. 실제 게임명·기기·결과를 기록할 항목은 [PRD](PRD.md)의 인수 시험, 구현 및 리뷰 이력은 [개발 계획](PLAN.md)에 있다.
