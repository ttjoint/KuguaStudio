import { webcrypto } from 'crypto';

const crypto = webcrypto as Crypto;

const SimNewLine = '\r\n';

export class MyRandom {
    private static readonly MAX_INT = 0x7FFFFFFF;

    static get NextDouble(): number {
        const array = new Uint32Array(1);
        crypto.getRandomValues(array);
        return array[0] / MyRandom.MAX_INT;
    }

    static Next(maxValue: number): number;
    static Next(minValue: number, maxValue: number): number;
    static Next(minOrMax: number, maxValue?: number): number {
        let min = 0;
        let max = minOrMax;

        if (maxValue !== undefined) {
            min = minOrMax;
            max = maxValue;
        }

        if (min >= max) {
            return min;
        }

        const range = max - min;
        const rand = MyRandom.NextDouble;
        return Math.floor(rand * range) + min;
    }
}

export class DValue {
    static readonly DefaultFrequent = 10;
    static readonly MaxReplaceCount = 10000;

    Name: string;
    Templates: Array<{ freq: number; template: string }>;
    AllFrequent: number = 0;

    constructor(name?: string, templates?: string[]) {
        this.Name = name ?? '';
        this.Templates = [];

        if (templates) {
            for (const t of templates) {
                this.Add(t, DValue.DefaultFrequent);
            }
        }
    }

    Add(template: string, freq: number): void {
        if (freq <= 0) {
            freq = 1;
        }

        const processed = template.replace(/#/g, SimNewLine);

        this.Templates.push({ freq, template: processed });
        this.AllFrequent += freq;
    }

    GetTemplate(): string {
        if (this.Templates.length === 0) {
            return '';
        }

        if (this.Templates.length === 1) {
            return this.Templates[0].template;
        }

        let r = MyRandom.Next(0, this.AllFrequent);

        for (const item of this.Templates) {
            if (r < item.freq) {
                return item.template;
            }
            r -= item.freq;
        }

        return this.Templates[this.Templates.length - 1].template;
    }

    Result(existParams?: DValue[], nowCount: number = 0): string {
        if (nowCount > DValue.MaxReplaceCount) {
            return this.GetTemplate();
        }

        let result = this.GetTemplate();

        if (!existParams || existParams.length === 0) {
            return result;
        }

        const maxRounds = 255;
        for (let round = 0; round < maxRounds; round++) {
            let replaced = false;

            for (const param of existParams) {
                if (!param.Name || param.Name.length === 0) {
                    continue;
                }

                const key = param.Name;
                let pos = result.indexOf(key);

                while (pos !== -1) {
                    replaced = true;
                    const replacement = param.Result(existParams, nowCount + 1);
                    result = result.substring(0, pos) + replacement + result.substring(pos + key.length);
                    pos = result.indexOf(key, pos + replacement.length);
                }
            }

            if (!replaced) {
                break;
            }
        }

        return result;
    }
}

export class DScriptFile {
    NamedTemplates: Map<string, DValue> = new Map();
    AnonymousTemplates: DValue[] = [];

    Load(scriptString: string): boolean {
        this.NamedTemplates.clear();
        this.AnonymousTemplates.length = 0;

        const lines = scriptString.split('\n');

        let current: DValue | null = null;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.length === 0) {
                continue;
            }

            if (trimmed === '#') {
                current = new DValue();
                this.AnonymousTemplates.push(current);
                continue;
            }

            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                const name = trimmed.substring(1, trimmed.length - 1);
                current = new DValue(name);
                this.NamedTemplates.set(name, current);
                continue;
            }

            if (current === null) {
                current = new DValue();
                this.AnonymousTemplates.push(current);
            }

            let freq = DValue.DefaultFrequent;
            let content = trimmed;

            const tabPos = trimmed.indexOf('\t');
            if (tabPos > 0) {
                const freqStr = trimmed.substring(0, tabPos);
                const parsedFreq = parseInt(freqStr, 10);
                if (!isNaN(parsedFreq) && parsedFreq > 0) {
                    freq = parsedFreq;
                    content = trimmed.substring(tabPos + 1).trim();
                }
            }

            current.Add(content, freq);
        }

        return true;
    }

    GetResult(entryKey?: string | null, extraParams?: DValue[]): string {
        const params: DValue[] = [];

        if (extraParams) {
            params.push(...extraParams);
        }

        for (const dv of this.NamedTemplates.values()) {
            params.push(dv);
        }

        let entry: DValue | null = null;

        if (entryKey && this.NamedTemplates.has(entryKey)) {
            entry = this.NamedTemplates.get(entryKey)!;
        } else if (this.NamedTemplates.has('main')) {
            entry = this.NamedTemplates.get('main')!;
        } else if (this.AnonymousTemplates.length > 0) {
            const idx = MyRandom.Next(0, this.AnonymousTemplates.length);
            entry = this.AnonymousTemplates[idx];
        }

        if (entry === null) {
            return '';
        }

        return entry.Result(params, 0);
    }
}
