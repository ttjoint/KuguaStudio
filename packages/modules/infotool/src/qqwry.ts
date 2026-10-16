/**
 * 纯真 IP 库（QQWry.dat）解析
 * 严格复刻参考项目 `Integrations/QQWry.cs` 的二分查找与字符串/区域读取逻辑。
 * 文本编码为 GB2312/GB18030。
 */

import { readFileSync } from "node:fs";

export class QQWry {
  private bytes: Buffer;
  private 索引头: number;
  private 索引尾: number;
  private 解码器 = new TextDecoder("gb18030");

  constructor(file: string) {
    this.bytes = readFileSync(file);
    this.索引头 = this.读U32(0);
    this.索引尾 = this.读U32(4);
  }

  /** 查询 IP 归属，返回 [国家/地区, 区域, 备注]（未命中返回空串） */
  find_info(ip: string): [string, string, string] {
    const 段 = ip.trim().split(".");
    if (段.length !== 4 || 段.some((s) => !/^\d+$/.test(s))) return ["", "", ""];
    const nip =
      ((Number(段[0]) << 24) | (Number(段[1]) << 16) | (Number(段[2]) << 8) | Number(段[3])) >>> 0;

    let head = this.索引头;
    let tail = this.索引尾;
    while (tail > head) {
      let cur = Math.floor(Math.floor((tail - head) / 7) / 2);
      cur = head + (cur === 0 ? 1 : cur) * 7;
      const ipMin = this.读U32(cur);
      let pos = this.读U24(cur + 4);
      const ipMax = this.读U32(pos);
      if (nip < ipMin) {
        tail = cur;
      } else if (nip > ipMax) {
        head = cur;
      } else {
        pos += 4;
        const mode = this.bytes[pos];
        if (mode === 0x01) {
          const mainOffset = this.读U24(pos + 1);
          if (this.bytes[mainOffset] === 0x02) {
            const [info0, info1] = this.readInfos(mainOffset, pos + 8);
            return [info0, info1, this.readArea(mainOffset + 4)];
          }
          const [info0, info1, size] = this.readInfos(mainOffset);
          return [info0, info1, this.readArea(mainOffset + size + 1)];
        }
        if (mode === 0x02) {
          const mainOffset = this.读U24(pos + 1);
          const [info0, info1] = this.readInfos(mainOffset, pos + 4);
          return [info0, info1, ""];
        }
        const [info0, info1, size] = this.readInfos(pos);
        return [info0, info1, this.readArea(pos + size + 1)];
      }
    }
    return ["", "", ""];
  }

  private readInfos(mainPos: number, subPos = 0): [string, string, number] {
    const { s: mainInfo, len } = this.readItemString(mainPos);
    const 有效Sub = subPos === 0 ? mainPos + len : subPos;
    const { s: subInfo } = this.readItemString(有效Sub);
    return [mainInfo, subInfo, len];
  }

  private readArea(areaPos: number): string {
    const mode = this.bytes[areaPos];
    if (mode === 1 || mode === 2) {
      const 偏移 = this.读U24(areaPos + 1);
      if (偏移 === 0) return "";
      return this.readItemString(偏移).s;
    }
    return this.readItemString(areaPos).s;
  }

  private 读U24(pos: number): number {
    return this.bytes[pos] | (this.bytes[pos + 1] << 8) | (this.bytes[pos + 2] << 16);
  }

  private 读U32(pos: number): number {
    return this.bytes.readUInt32LE(pos);
  }

  private readItemString(pos: number): { s: string; len: number } {
    if (this.bytes[pos] === 0x01 || this.bytes[pos] === 0x02) {
      pos = this.读U24(pos + 1);
      if (this.bytes[pos] >= 0x00 && this.bytes[pos] <= 0x02) return { s: "", len: 0 };
    }
    const 起 = pos;
    while (this.bytes[pos] !== 0x00) pos++;
    return { s: this.解码器.decode(this.bytes.subarray(起, pos)), len: pos - 起 };
  }
}
