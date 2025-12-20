export const DRAFT_STAGE_PASSIVE_DISCARD = 0;
export const DRAFT_STAGE_INIT = 10;
export const DRAFT_STAGE_PASSIVE = 20;

export const PHASE_LOBBY = 0
export const PHASE_DRAFT = 10
export const PHASE_SIMULATING = 20

export class PlayerDeck {
    readonly name: string;
    private slots: Map<string, Character | null>;

    constructor(name: string) {
        this.name = name;
        this.slots = new Map();
        POSITIONS.forEach(pos => {
            this.slots.set(pos.key, null);
        });
    }

    assignCharacter(posKey: string, character: Character): void {
        if (!this.slots.has(posKey)) {
            throw new Error(`Position ${posKey} does not exist in the game.`);
        }
        this.slots.set(posKey, character);
    }

    addCharacter(character: Character): void {
        for (const [key, value] of this.slots) {
            if (value === null) {
                this.slots.set(key, character);
                return;
            }
        }
    }

    switchPositions(posKeyA: string, posKeyB: string): void {
        if (!this.slots.has(posKeyA) || !this.slots.has(posKeyB)) {
            throw new Error("One or both positions are invalid.");
        }

        const charA = this.slots.get(posKeyA) || null;
        const charB = this.slots.get(posKeyB) || null;

        this.slots.set(posKeyA, charB);
        this.slots.set(posKeyB, charA);
    }

    isComplete(): boolean {
        return Array.from(this.slots.values()).every(char => char !== null);
    }

    serialize(): string {
        const data: Record<string, string | null> = {};
        this.slots.forEach((char, key) => {
            data[key] = char ? char.名字 : null;
        });
        return JSON.stringify(data);
    }

    getPosition(posKey: string): Character | null {
        return this.slots.get(posKey) || null;
    }
}

export interface Skill {
    技能名: string;
    技能描述: string;
}

export interface AbilityValues {
    智力: number;
    武力: number;
    政治: number;
    魅力: number;
    统帅: number;
}

export interface Tags {
    标签1?: string;
    标签2?: string;
    标签3?: string;

    [key: string]: string | undefined;
}

export interface Character {
    UID: string;
    ID: string;
    名字: string;
    时代: string;
    地理位置: string;
    费用: number;
    稀有度_数字: number;
    稀有度: string;
    职业: string;
    身份: string;
    描述: string;
    技能: Skill;
    能力值: AbilityValues;
    标签: Tags;
}

export const POSITIONS = [
    {key: "皇帝", desc: "政权主脑，最高统治者", stats: ["智力", "政治", "魅力"]},
    {key: "太子", desc: "继任者，辅佐主脑", stats: ["智力", "政治", "魅力"]},
    {key: "丞相", desc: "文官之首，统筹规划", stats: ["智力", "政治", "魅力"]},
    {key: "尚书", desc: "核心执行，具体落实", stats: ["智力", "政治"]},
    {key: "鸿胪", desc: "外交、对外传播、文化", stats: ["智力", "魅力"]},
    {key: "司农", desc: "财政、贸易、后勤", stats: ["智力", "政治", "统帅"]},
    {key: "司天", desc: "科技发展、天文地理", stats: ["智力"]},
    {key: "谋士", desc: "军师参谋，出谋划策", stats: ["智力", "统帅"]},
    {key: "绣衣", desc: "情报、间谍、暗杀", stats: ["智力", "武力"]},
    {key: "廷尉", desc: "治安、刑法、民心", stats: ["政治", "统帅"]},
    {key: "统帅", desc: "三军大元帅，总体战略", stats: ["政治", "智力", "统帅"]},
    {key: "主将", desc: "军团司令，正面战场", stats: ["统帅", "武力"]},
    {key: "先锋", desc: "突击队长，阵前单挑", stats: ["武力"]},
    {key: "禁卫", desc: "皇帝近卫，安全核心", stats: ["武力", "统帅"]},
]
