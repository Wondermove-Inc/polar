# Polar

Polar는 Windows 11 x64용 개인 게임 런처다. Steam, Epic Games, Xbox에서 설치한 게임을 한 화면에서 선택한다. 홈은 키보드·마우스와 표준 매핑 게임패드를 지원한다. 설정에서 한국어와 English를 바꿀 수 있다.

## 설치와 사용

1. `Polar-1.0.0-rc.1-windows-x64-setup.exe`를 실행한다. 현재 사용자 계정에 설치된다. WebView2가 없는 PC에서는 설치 프로그램이 Microsoft 다운로드 페이지를 안내한다.
2. 시작 메뉴에서 **Polar**를 연다. 먼저 저장된 목록을 보여준 뒤 세 플랫폼을 각각 탐색한다. 좌우로 타일을 선택하고 확인 버튼이나 Enter로 실행한다. 설정의 **게임 라이브러리**에서 플랫폼별 결과와 진단을 확인한다.
3. 자동 감지되지 않는 게임은 **라이브러리 → 게임 추가**에서 기존 게임 바로가기 또는 등록 앱을 선택한다. 표시 이름과 플랫폼을 확인한 뒤 저장한다. 직접 등록한 항목은 설정의 게임 라이브러리에서 변경·제거한다.
4. 게임 창과 실행 프로세스를 확인할 수 있으면 종료 시 선택한 타일로 복귀한다. 추가 실행기나 계정 확인 창에서 자동 추적이 어려우면 Alt+Tab으로 돌아올 수 있다. 바탕 화면 전환은 Polar를 최소화한다.
5. 업데이트할 때 Polar를 종료한 뒤 새 설치 파일을 실행한다. Windows의 설치된 앱에서 제거할 수 있다. 게임 파일, 세이브와 Polar의 사용자별 데이터는 설치 폴더와 분리된다.

## 개발과 검증

- Rust CLI와 플랫폼 탐색 회귀 시험은 `cargo test --locked`, UI 모델 시험은 `node --test tests/desktop-model.mjs`로 실행한다.
- Windows x64 MSVC 환경에서 Rust, Visual Studio C++ 빌드 도구, NSIS 3을 설치한 뒤 `.\packaging\build.ps1`을 실행하면 `target\dist`에 개인 설치 파일이 생성된다. CLI는 별도로 `cargo run -- list`로 실행한다.
- 브라우저 시험은 `desktop/ui`를 로컬 정적 서버로 연 뒤 해당 주소를 `POLAR_TEST_URL`에 지정하고 Playwright가 설치된 환경에서 `node tests/desktop-ui.cjs`, `node tests/desktop-flows.cjs`, `node tests/desktop-input.cjs`를 실행한다. 이 시험의 네이티브 명령 응답은 fixture다.
- Rust가 읽는 원본은 Steam 설치 기록과 로컬 앱 종류 캐시, Epic 설치 매니페스트 및 Windows 등록 앱·게임 메타데이터다. Xbox 등록 정보는 Windows 기본 PowerShell로 조회하고 로컬 드라이브의 XboxGames 또는 .GamingRoot가 지정한 설치 위치와 대조한다. Steam 캐시에서 게임 종류가 확인되지 않은 항목은 바로가기로 추가할 수 있다. 수동 항목의 원본은 Rust가 관리하고, UI 캐시와 즐겨찾기·언어는 사용자별 WebView 데이터에 저장한다.

현재 배포 등급은 Windows 실기기 인수 전의 출시 후보이다. 실제 게임명·기기·결과를 기록할 항목은 [PRD](PRD.md)의 인수 시험, 구현 및 리뷰 이력은 [개발 계획](PLAN.md)에 있다.
