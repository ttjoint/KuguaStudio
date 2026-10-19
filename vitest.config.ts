import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    /**
     * `packages/modules/job` 用 `node:sqlite`（Node 24 内置模块）。
     *
     * 这里保留 external 声明不删：它是「不要试图把内置模块打成 npm 包」的
     * 意图说明。**真正让 vitest 跑通的是 store.ts 里的 createRequire**——
     * vitest 在 transform 阶段会把 `import "node:sqlite"` 剥成裸名
     * `sqlite` 再当包 resolve，然后报 "Failed to load url sqlite"。
     * external 对此无效（它只对 npm 包生效），但留着能提醒后来者这里踩过坑。
     */
    server: {
      deps: {
        external: ["node:sqlite"],
      },
    },
    /**
     * 测试文件之间不并行。
     *
     * `bad-request` / `startup-robustness` / `platform-lifecycle` 的每个用例都
     * 真的 spawn 一个 WebUI（它自己又会 spawn 一个主控），等端口就绪再断言退出
     * 行为。vitest 默认按文件并行，几个文件同时跑就是几份平台实例抢 CPU 和
     * 端口，启动等待被拉长到几十秒——表现为全量里偶发超时、单独跑一定通过。
     *
     * 试过用 poolMatchGlobs + singleFork 只把这三个文件串起来，实测不生效
     * （失败反而转移到别的文件），所以直接关掉文件级并行。
     *
     * 代价是全量变慢（约 20 秒的集成用例不再重叠）。三十来个测试文件、
     * 十几秒的差距换一个确定的绿，值得——"再跑一遍就好了"不能算修好。
     *
     * **复现记录（2026-10-23）**：把这一行临时改回 `true` 连跑时，第 2 次
     * 出现 `1 failed | 478 passed`，具体用例未打出来；之后又连跑 8 次全过。
     * 说明这是**概率性**的、由机器负载触发，不是每次都红。三个会真 spawn
     * 的文件（bad-request / startup-robustness / platform-lifecycle）已经各自
     * 隔离了全局锁，所以抢的不是锁而是 **CPU 与端口**：每个用例都要起一个
     * WebUI + 一个主控，等端口就绪，并行时启动等待被拉长到撞 20 秒超时。
     *
     * 偶发失败率低不等于没有问题——它意味着**换个负载更重的机器就会变常见**。
     */
    fileParallelism: false,
  },
});
