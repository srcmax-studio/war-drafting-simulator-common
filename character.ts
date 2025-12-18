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
