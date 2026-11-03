// guards.ts —— 数值钳制与非法 state 兜底
// 所有进入状态机的外部数据（文件、配置、钩子产物）都必须先过这里，
// 任何字段非法都退化到默认值，绝不抛错，避免把一次坏输入变成整段人格崩掉。
export const MOODS = [
    'calm', 'cozy', 'alert', 'hiss', 'wronged', 'clingy', 'cold',
];
export const PRESET_NAMES = ['gentle', 'tsundere', 'berserk'];
export function clamp01(n) {
    const v = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(v))
        return 0;
    return Math.min(1, Math.max(0, v));
}
function asMood(v) {
    return MOODS.includes(v) ? v : undefined;
}
function sanitizePersona(input, fallback) {
    const o = (input ?? {});
    const name = PRESET_NAMES.includes(o.preset)
        ? o.preset
        : fallback.preset;
    return {
        preset: name,
        compliance: clamp01(o.compliance ?? fallback.compliance),
        edge: clamp01(o.edge ?? fallback.edge),
        cling: clamp01(o.cling ?? fallback.cling),
        snap: clamp01(o.snap ?? fallback.snap),
        leak: clamp01(o.leak ?? fallback.leak),
    };
}
/** 把任意 JSON 对象修复成合法 NekoState；任何字段坏掉都填默认，保证返回永不抛错。 */
export function sanitizeState(input, fallback) {
    const o = (input ?? {});
    return {
        mood: asMood(o.mood) ?? fallback.mood,
        arousal: clamp01(o.arousal ?? fallback.arousal),
        affinity: clamp01(o.affinity ?? fallback.affinity),
        grudge: clamp01(o.grudge ?? fallback.grudge),
        last_trigger: typeof o.last_trigger === 'string' ? o.last_trigger : fallback.last_trigger,
        since_last_shift: Number.isFinite(Number(o.since_last_shift))
            ? Math.max(0, Math.floor(Number(o.since_last_shift)))
            : fallback.since_last_shift,
        persona: sanitizePersona(o.persona, fallback.persona),
    };
}
/** 校验并钳制单旋钮覆盖，键名是中文文档口径，这里做映射。 */
export function mapKnob(key) {
    const m = {
        compliance: 'compliance',
        顺从度: 'compliance',
        攻击性: 'edge',
        edge: 'edge',
        黏人度: 'cling',
        cling: 'cling',
        炸毛阈值: 'snap',
        snap: 'snap',
        流露度: 'leak',
        leak: 'leak',
    };
    return m[key];
}
