import type { BrainstormSkill } from "./brainstorm-agent";

const BRAINSTORM_SKILLS: readonly BrainstormSkill[] = Object.freeze([
    Object.freeze({
        id: "divergent_ideation",
        version: "1.0.0",
        label: "发散构思",
        description: "从当前故事焦点生成差异鲜明的可选方向。",
        instruction: "围绕当前焦点提出至少三个差异明显、可继续发展的方案，并说明每个方案的核心吸引力、关键变化与潜在代价。避免只改写措辞或重复同一思路。",
    }),
    Object.freeze({
        id: "character_conflict",
        version: "1.0.0",
        label: "角色冲突",
        description: "强化角色目标、阻力与戏剧张力。",
        instruction: "从角色目标、阻力、筹码、隐瞒与代价分析冲突，提出能迫使角色做出选择的升级方式。保持行为符合既有人物动机。",
    }),
    Object.freeze({
        id: "visual_storytelling",
        version: "1.0.0",
        label: "视觉叙事",
        description: "把抽象信息转化为可拍摄的画面表达。",
        instruction: "优先用动作、构图、场面调度、道具、光线与环境变化传递信息和情绪，减少依赖解释性对白，并给出具体可拍摄的视觉方案。",
    }),
    Object.freeze({
        id: "shot_rhythm",
        version: "1.0.0",
        label: "镜头节奏",
        description: "调整镜头组织、信息释放与情绪节拍。",
        instruction: "检查景别、机位、运动、镜头时长、剪辑点与信息释放顺序，指出拖沓或突兀的位置，并提出节奏更清晰的镜头调整方案。",
    }),
    Object.freeze({
        id: "continuity_check",
        version: "1.0.0",
        label: "连贯性检查",
        description: "发现故事与镜头之间的连续性问题。",
        instruction: "核对人物动机、时空关系、动作衔接、道具状态、视线与轴线，列出明确矛盾及其影响，并给出不改变核心意图的最小修正建议。",
    }),
]);

export function listBrainstormSkills(): readonly BrainstormSkill[] {
    return BRAINSTORM_SKILLS;
}

export function getBrainstormSkill(id: string): BrainstormSkill {
    const skill = BRAINSTORM_SKILLS.find((candidate) => candidate.id === id);
    if (!skill) throw new Error(`Unknown brainstorm skill: ${id}`);
    return skill;
}
