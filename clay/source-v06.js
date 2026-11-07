// The artist's original geometry is a substitute only for this exact published layout.
export const v06Source = {
  renderId: 'v06-source',
  model: '../studio/modules/a5f967f6-aaaf-574e-b3ef-d26e76c05bde/versions/7e655b0f-2336-51a0-bb0e-06beb6576f8a/files/riraji_normal.glb',
  profile: './assets/profile.json',
  sha256: 'dddb88e38907948c093ced298229e6b1ddc90793a76791735baab632a9444488',
  bytes: 11630788
};

export function useOriginalScene(record) {
  return record.renderId === '159788df-e0af-5a63-b095-b6681595f040'
    && record.sha256 === 'cd63302593e0249f19b996ad9dda56f852840ef7c1611fb183242b5c44113c50'
    && record.digest === 'dc53d4db550d5de51eea69f679c5d3ebd09c06d584faff14715393c25ee87cb1';
}
