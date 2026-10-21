// Fix quality for this session; resizing must not reload heavy desktop assets.
export const mobile = matchMedia('(pointer: coarse), (max-width: 650px)').matches;
export const mobileProps = new Set(['old_tyre', 'wooden_crate_01', 'football', 'painted_wooden_bench', 'wooden_picnic_table', 'barrel_stove', 'wooden_bucket_01', 'folding_wooden_stool']);
