import type { Character } from "~/common/character";

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

export class PlayerDeck {
    readonly name: string;
    private slots: Map<string, Character | null>;

    constructor() {
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


