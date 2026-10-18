import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
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
     * 代价是全量变慢（约 20 秒的集成用例不再重叠）。这个项目总共就 27 个测试
     * 文件、十几秒的差距换一个确定的绿，值得——"再跑一遍就好了"不能算修好。
     */
    fileParallelism: false,
  },
});
