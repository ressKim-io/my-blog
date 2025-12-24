# TODO: ASCII 다이어그램 → 이미지 전환 작업

## 작업 내용
- 블로그 글들의 ASCII 아트 다이어그램을 깔끔한 이미지로 전환

## 대상 파일들 (istio 시리즈 전체)
- `src/content/istio-intro-part*.md` (3편)
- `src/content/istio-security-part*.md` (4편)
- `src/content/istio-traffic-part*.md` (5편)
- `src/content/istio-observability-part*.md` (4편)
- `src/content/istio-ambient-part*.md` (7편)

## 작업 방식 (예상)
1. ASCII 다이어그램 추출
2. 이미지 생성 도구로 변환 (Excalidraw, draw.io, Mermaid 등)
3. `public/images/istio/` 또는 `assets/images/istio/`에 저장
4. 마크다운에서 이미지로 교체

## 참고
- 총 23편의 글에 ASCII 다이어그램 다수 포함
- 아키텍처, 흐름도, 비교표 등 다양한 형태
