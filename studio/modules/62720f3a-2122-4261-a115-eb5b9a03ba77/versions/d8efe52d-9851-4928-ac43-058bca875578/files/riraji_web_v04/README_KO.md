# 리라지 웹용 3D 출력 v04

- riraji_normal.glb: 기본 사용 권장. 베벨 메시와 2048px 노멀 아틀라스를 포함합니다.
- riraji_displacement.glb: 표면 굴곡을 실제 메시로 표현한 비교용 버전. 웹용으로 subdivision을 2단계로 낮췄습니다.
- 두 파일은 각각 독립적으로 사용할 수 있으며 재질과 텍스처가 GLB 안에 포함됩니다.
- clay_normal_atlas.png: 노멀 텍스처 원본 사본. GLB 로드 시 별도 파일은 필요 없습니다.
- PNG 두 장은 Blender 렌더 미리보기입니다.

## 크기와 구성

1 glTF 단위는 1m이며 Y축이 위입니다. 원본 평면과 방별 크기는 유지했습니다.
일반 벽 높이 4.65m, 편집샵 벽 높이 5.4m, 벽 두께 1.26m.
두 기린 모델과 방별 WebRoot 노드가 포함되어 그룹 단위로 숨기거나 선택할 수 있습니다.
정사영 카메라가 포함됩니다. 배경판과 스튜디오 조명은 제외했습니다.

## 웹 적용

정적 파일 서버의 assets 폴더 등에 GLB를 올린 다음 웹 3D 엔진의 glTF 로더로 불러오세요.
단독 GLB만으로 Blender의 조명과 그림자가 재현되지는 않습니다. 웹 장면에 환경광, 부드러운 조명과 그림자를 설정해야 합니다. 유리 투과 재질을 지원하는 렌더러가 필요합니다.
노멀 버전은 기본 공개용, displacement 버전은 비교 및 고성능 기기용으로 권장합니다. 모바일 성능은 실제 홈페이지에 통합한 후 측정해야 합니다.
원본 Blender 파일은 상위 output/riraji_clay_v04.blend에 보존되어 있습니다.

## 출력 검증

GLB 헤더, 내장 텍스처, 방별 루트와 삼각형 수를 검사하고 Blender에서 다시 가져오기를 확인했습니다.

[
  {
    "file": "riraji_normal.glb",
    "bytes": 4201896,
    "triangles": 115776,
    "normalMaterials": 18,
    "externalImages": 0,
    "roots": [
      "01_MentalSauna_WebRoot",
      "02_Sports_WebRoot",
      "03_Supporters_WebRoot",
      "04_Vintage_WebRoot",
      "05_Scale_Giraffes_WebRoot"
    ]
  },
  {
    "file": "riraji_displacement.glb",
    "bytes": 17399120,
    "triangles": 684036,
    "normalMaterials": 0,
    "externalImages": 0,
    "roots": [
      "01_MentalSauna_WebRoot.001",
      "02_Sports_WebRoot.001",
      "03_Supporters_WebRoot.001",
      "04_Vintage_WebRoot.001",
      "05_Scale_Giraffes_WebRoot.001"
    ]
  }
]