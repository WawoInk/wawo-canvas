import assert from "node:assert/strict";
import { test } from "node:test";

import { getBrainstormSkill, listBrainstormSkills } from "./brainstorm-agent-skills.ts";

test("skill registry lists the five stable versioned storyboard skills", () => {
    assert.deepEqual(
        listBrainstormSkills().map(({ id, version }) => ({ id, version })),
        [
            { id: "divergent_ideation", version: "1.0.0" },
            { id: "character_conflict", version: "1.0.0" },
            { id: "visual_storytelling", version: "1.0.0" },
            { id: "shot_rhythm", version: "1.0.0" },
            { id: "continuity_check", version: "1.0.0" },
        ],
    );
});

test("skill lookup returns the preset and clearly rejects unknown runtime IDs", () => {
    assert.equal(getBrainstormSkill("visual_storytelling"), listBrainstormSkills()[2]);
    assert.throws(
        () => getBrainstormSkill("unknown_skill"),
        (error) => error instanceof Error && error.message === "Unknown brainstorm skill: unknown_skill",
    );
});

test("skill presets are immutable and contain only prompt metadata", () => {
    const skills = listBrainstormSkills();
    assert.equal(Object.isFrozen(skills), true);
    for (const skill of skills) {
        assert.equal(Object.isFrozen(skill), true);
        assert.deepEqual(Object.keys(skill), ["id", "version", "label", "description", "instruction"]);
        assert.ok(skill.label.length > 0 && skill.description.length > 0 && skill.instruction.length > 0);
    }
    assert.throws(() => skills.push(skills[0]), TypeError);
    assert.throws(() => {
        skills[0].label = "changed";
    }, TypeError);
});
