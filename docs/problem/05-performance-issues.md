# 性能问题

> 本文档记录 ACC 当前架构中属于 "性能问题" 类别的、经过对抗式验证确认存在的问题。
> 目标是维持 ACC 的健壮性、轻量性与高性能，移除冗余与不适配的实现。
> 本文档只做问题发现与建议，不修改代码。

## 摘要

ACC 当前的性能问题集中在两类典型反模式上：一是**热路径上的"重复 I/O"**——同一份数据在一次调用中被反复读取、反复解析、反复序列化（finding #4、#5、#6、#7、#8、#9）；二是**O(N) 全量扫描代替 O(1) 直查**——目录被反复 glob、文件被反复 JSON 解析，本可以靠文件名约定或轻量索引短路（finding #1、#3、#7、#8）。此外，SSE 路径上还存在一处真正会阻塞 asyncio 事件循环的同步 I/O 调用（finding #2），在多客户端并发时会放大上述所有 I/O 开销的影响。这些问题不会立刻让系统不可用，但都直接削弱了 "ACC 应保持轻量、低延迟" 的架构目标，且历史规模（项目 run 数、workflow 数、嵌套节点数）越大，劣化越明显。

## 详细问题清单

### 1. [CRITICAL] write_core_v2_run_summary 每次都从零重建 run index

**证据**:
- `acc/app/core_v2_runtime.py` (818-819)：`if run_dir.parent.name == 'runs': write_json(..., rebuild_run_index(run_dir.parent).model_dump())` —— 在 write_core_v2_run_summary 末尾调用。
- `acc/app/core_v2_runtime.py` (132-138 与 207-214)：write_core_v2_run_summary 在每次 run 中至少被调用两次（开始一次、结束一次），失败路径上还可能更多。
- `acc/run_index.py` (111-120)：rebuild_run_index 遍历 `runs_root.iterdir()`，对每个子目录调用 load_run_summary，单个目录最多 4 次文件系统探测。

**为什么是问题**：原始描述用 "O(N×R)" 与 "fires on every node completion" 略显夸张——实际节点不会触发重建，每个 run 触发约 2 次。但即便如此：在一个有 100 条历史 run 的项目里，单次 run 至少要做 `2 × 100 × 4 ≈ 800` 次 stat/read，仅仅是为了写一份 summary。代价随项目历史线性增长，且属于热路径上完全可以避免的开销。

**建议**：把已经构造好的 RunSummary 对象直接传入 write_core_v2_run_summary，让它写入自己的 `run_summary.json` 后，再用一个 `upsert_run_index_entry(runs_root, summary)` 辅助函数：load `index.json` → 替换/追加匹配的 run_id → 原子重写。从 O(R) 次文件系统探测降到 1 次 JSON parse + 1 次写入。`index.json` 已经是 `RunIndex(list[RunSummary])` 结构，无需 schema 变更。

**可行性 / 风险**：变更范围收敛在 write_core_v2_run_summary 内部及一个新 helper。调用点（line 817 附近）已经持有 `summary` 变量，重构成本极低。

---

### 2. [CRITICAL] SSE event_source 在 async 生成器内做同步阻塞 I/O

**证据**:
- `acc/server/routes/runs.py` (156-201)：`async def event_source()` 在每个 0.5s tick 里直接调用 iter_node_dirs、read_node_log_delta 与 `run_summary.json.read_text`，全部为同步 I/O，未通过 `anyio.to_thread` 委派。
- `acc/server/routes/runs.py` (268-272)：`with log_path.open('rb') as file: file.seek(safe_offset); chunk = file.read(...)` —— 直接在 async 生成器函数体内同步读文件。
- `acc/server/routes/runs.py` (285-289)：iter_node_dirs 调用 `nodes_dir.iterdir()` —— 目录列举同样在 tick 中同步执行。

**为什么是问题**：FastAPI/Uvicorn 的 async handler 跑在 asyncio event loop 上。stat()/open()/read()/iterdir() 这些 syscall 没有 to_thread 委派的话，在 syscall 期间整个事件循环被阻塞。一旦有多个 SSE 客户端，每 0.5s 的 tick 都会卡住其它所有请求。严重度标记为 critical 在"开发/监控端点"语境下略偏重，但事件循环阻塞这一缺陷本身是确定的。

**建议**：在每个调用点用 `await asyncio.to_thread(func, ...)`（Python 3.9+）或 `loop.run_in_executor(None, func, ...)` 包一层。更系统的做法是把 log delta 的轮询放到独立后台线程，通过 `asyncio.Queue` 把 payload 推给生成器。最小改动：把 read_node_log_delta、iter_node_dirs、`summary_path.read_text()` 三处包成 `await asyncio.to_thread(...)`。

**可行性 / 风险**：中等工作量，仅在 event_source 的循环体内每个 tick 包 2~3 个调用点，无数据模型变更。

---

### 3. [MAJOR] find_graph_path 每次请求都要 glob 并 JSON 解析整个 workflows 目录

**证据**:
- `acc/server/routes/workflows.py` (700-704)：`for path in sorted(workflows_dir.glob('*.accflow.json')): payload = load_json_or_500(path); ...` —— 全目录扫 + 全文件解析，只为找一个 ID。
- `acc/server/routes/workflows.py` (195-224)：get_workflow 使用同样的"先 yaml 后 accflow 两遍 glob+parse"模式。
- `acc/server/routes/workflows.py` (253-258 与 361-380)：validate_workflow_endpoint、run_workflow_endpoint 都通过 find_graph_path 解析路径，三个端点都付 O(W×IO) 代价。

**为什么是问题**：每次 GET /workflows/{id}、POST /workflows/{id}/validate、POST /workflows/{id}/run 都会扫描整个目录并完整解析每个文件来匹配 ID，即使文件名本身就编码了 ID。

**建议**：先尝试文件名直查 `workflows_dir / f'{workflow_id}.accflow.json'`，命中即返回；只有 miss 时才 fallback 到现有 glob 循环。常见路径从 O(W) IO 降到 O(1)。文件创建约定（line 234）默认就是 `f"{workflow_id}.accflow.json"`，覆盖绝大多数场景。可选的下一步是维护一个轻量 in-memory id→path 索引，懒加载、写入时失效。

**可行性 / 风险**：在 find_graph_path 前面加 2 行快速路径，对常见路径无行为变化，仅在 ID 字段与文件名不一致的边缘场景下走到旧分支。

---

### 4. [MAJOR] reconcile_wakeup_state 在一次调用里读两遍 JSONL 队列文件

**证据**:
- `acc/app/scheduler.py` (92-99)：第一遍 `for line in queue_path.read_text(encoding='utf-8').splitlines(): ... consumed_ids.add(request_id)`。
- `acc/app/scheduler.py` (100-114)：第二遍 `if queue_path.exists(): for line in queue_path.read_text(encoding='utf-8').splitlines():` —— 同一文件再次从磁盘读取，构建 pending 字典。

**为什么是问题**：reconcile_wakeup_state 调用 `queue_path.read_text()` 两次，遍历完全相同的内容。该函数被 enqueue_wakeup、claim_next_ready、load_wakeup_state 调用——也就是每次 wakeup 操作都付出双倍读取成本。本地 FS 上 OS page cache 通常能吸收第二次读，但在 NFS 或慢盘上 syscall + 网络 round-trip 是真实代价。

**建议**：一次读入解析为 list of dict，再在内存里两遍走该 list；或单遍走 + 末尾过滤掉 consumed 项。无对外行为变化。

**可行性 / 风险**：5~10 行内完成，调用方不变，零风险。

---

### 5. [MAJOR] append_event 每个事件单开文件句柄，且 utc_now_iso 调用两次

**证据**:
- `acc/app/core_v2_runtime.py` (868-877)：`event = EventRecord(event_id=f'event_{utc_now_iso()}_{event_type}', ..., timestamp=utc_now_iso(), ...)`，随后 `with event_log_path.open('a', ...) as handle: handle.write(...)`。
- `acc/app/core_v2_runtime.py` (283-290)：append_event 在紧循环中被调用——每个 binding_record 一次，N 个输入绑定的节点会触发 N+2 次独立的 open/write/close。

**为什么是问题**：
1. 同一事件的 `event_id` 与 `timestamp` 来自两次独立的 utc_now_iso()，时间戳之间存在微小漂移，可能影响事件排序的可重现性；
2. 单事件单 open 在节点 fan-in 较多时会放大 syscall 数量，把本应一次 buffered write 拆成多次 O(1) syscall。

**建议**：
- 时间戳问题：在 append_event 顶部 `ts = utc_now_iso()` 一次，event_id 与 timestamp 共用。1 行改动。
- 文件 open 问题：要么让调用方持有一个打开的句柄（append_event 接受 handle 参数），要么把节点执行期间的 events 累积到 list，节点结束时一次性 flush。前者改动面更小。

**可行性 / 风险**：时间戳修复是 trivial、零风险的 1 行改动。文件批量化属于中等改动，需要把 buffer 串入 execute_core_v2_node 或修改 append_event 签名。

---

### 6. [MAJOR] 同一 value 被 JSON 序列化两次：sha256 一次、result store 又一次

**证据**:
- `acc/app/core_v2_runtime.py` (500-501)：`'source_result_sha256': sha256_json(value)`。
- `acc/app/core_v2_runtime.py` (505-507)：`def sha256_json(value: Any) -> str: inline = json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8'); return hashlib.sha256(inline).hexdigest()`。
- `acc/app/core_v2_runtime.py` (765-766)：`inline = json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')` —— put_result_store_value 中再次序列化同一 value。

**为什么是问题**：DAG 中每条 data-edge binding 都会让节点输出值 `json.dumps(sort_keys=True)` 两次。两处 flag 实际相同（均为 `ensure_ascii=False, sort_keys=True`），所以核心问题是"等价的重复工作"，而非语义不一致。对大型 payload，一次额外序列化就是一次实打实的延迟。

**建议**：在 put_result_store_value（或共享 helper）中一次性产出序列化字节，同时返回 digest 与 bytes；让 binding_record 接受预计算的 digest。或者：在 execute_core_v2_node 拿到 callable 返回值后立刻序列化，把 bytes 同时喂给 put_result_store_value 和 sha256 hash。

**可行性 / 风险**：中等重构，需要把"预序列化字节"沿两条调用路径透传，无语义变更。

---

### 7. [MAJOR] resolve_workflow_function_path 每次嵌套调用都重扫 workflow 目录

**证据**:
- `acc/app/core_v2_runtime.py` (578-601)：`overlay_payloads = load_runtime_overlay_payloads(base_dir)` 后立刻 `catalog = WorkflowCatalog(...)` —— 每次调用都重新构造。
- `acc/app/core_v2_runtime.py` (613-624)：load_runtime_overlay_payloads 在 base_dir 中 glob 全部 *.accflow.json 并逐一 `json.loads(path.read_text(...))`。
- `acc/app/core_v2_runtime.py` (605-610)：infer_project_root 沿父目录链 .exists() 探测，每个嵌套 workflow 节点都会无条件触发。

**为什么是问题**：每个 `callable_ref.kind == 'workflow_function'` 的节点都触发：(a) 父目录上行查找 project root；(b) glob+读 base_dir 下所有 accflow；(c) 全新的 WorkflowCatalog 构造。一个 workflow 中嵌套 workflow 节点越多，就把这套 O(全量) 的扫描重复 O(嵌套节点数) 次。这些 overlay payload 在一次 run 期间是静态的。

**建议**：在 run_core_v2_workflow_path 中加载一次 overlay payloads 并构造一次 WorkflowCatalog，沿 run_workflow_function_invocation → execute_core_v2_node → execute_core_v2_callable → execute_workflow_function_callable 把 catalog（或 path-resolver callable）传下去。O(嵌套节点数) 次 glob 收敛到 1 次。WorkflowCatalog 是只读 dataclass，可以安全地跨 async gather 共享。

**可行性 / 风险**：blast radius 是 3 个函数签名变更。子 workflow 递归调用 run_core_v2_workflow_path 时仍会自建 catalog——这是正确的，因为子 workflow 的 base_dir 可能不同；该方案天然按目录范围缓存，无需额外处理。

---

### 8. [MAJOR] list_workflows 与 get_workflow 每个请求都全量解析整个目录

**证据**:
- `acc/server/routes/workflows.py` (65-106)：list_workflows 先 glob *.yaml 再 glob *.accflow.json，对每个文件调用 load_yaml(path) 或 load_json_or_500(path) —— 整目录全量解析。
- `acc/server/routes/workflows.py` (194-224)：get_workflow 同样的两遍 glob + 全量 parse，仅为定位一个 workflow_id。

**为什么是问题**：每次 GET /workflows 或 GET /workflows/{id} 都会读取并完整反序列化所有 workflow 文件。50 个 workflow 就是 50 次 JSON/YAML parse。Workbench 在每次画布加载、每次保存时都会调用 list_workflows 来刷新侧边栏，单用户场景下也已经是可感知的 UX 延迟。

**建议**：
- list_workflows：抽出仅需的元数据（id、name、description、version、节点数），可选方案：(a) 维护 sidecar `workflows/index.json`，每次保存时更新；(b) 进程内 `(path, mtime) → metadata` 字典缓存，mtime 变化时失效。前者更鲁棒但需要每条写入路径都同步更新索引（save_graph、write_bundle_to_directory，lines 546-587 等多处）；后者无 on-disk 格式变更，是更小改动的起点。
- get_workflow：先尝试 `Path(workflows_dir / f"{workflow_id}.accflow.json")` 直查，命中即返回，miss 才走全扫——与 finding #3 共用同一思路。

**可行性 / 风险**：mtime 缓存是低风险增量；sidecar index 引入了写入端一致性义务，每个写路径都需要更新索引，属于中等风险。

---

### 9. [MINOR] inspect_session 重复读取 conductor_output.json

**证据**:
- `acc/cli.py` (720-721)：`conductor_output = load_json(conductor_path) if conductor_path.exists() else None`。
- `acc/cli.py` (745)：`'conductor_output': load_json(conductor_path) if conductor_path.exists() else None` —— 同一文件再次无条件读取。

**为什么是问题**：返回值字典里再次执行了和 line 720 完全等价的表达式，结果必然等于已绑定的 `conductor_output` 变量或 None，第二次 load 是纯冗余。

**建议**：把返回字典里的内联表达式替换为已绑定的 `conductor_output` 变量。

**可行性 / 风险**：1 行改动，零风险。

---

## 整体建议

**清理优先级**：

1. **先打事件循环阻塞（finding #2）**：这是唯一一条会让"并发用户互相拖累"的缺陷，影响面随客户端数线性放大，且修复机械、低风险。建议优先处理。
2. **再打热路径上的"全量扫描代替直查"（findings #1、#3、#7、#8）**：四条问题共享同一个反模式——用 glob+parse 替代了文件名约定或轻量索引。建议作为一组一起评估，用 helper 复用相同的"filename-first / sidecar index / mtime cache"模式，能用相同的设计思路批量解决。其中 #3 与 #8 在 server 层、#1 与 #7 在 runtime 层，可分两批落地。
3. **最后清理"局部重复 I/O / 重复序列化"（findings #4、#5、#6、#9）**：单点开销有限，但都属于改动范围小、无对外语义变化的清理项。可在前两批完成后顺手处理；finding #5 的时间戳子问题与 finding #9 可立即合并到任意临近改动中，不必单独排期。

**共性观察**：上述 9 条问题中有 6 条都源于"调用点直接做 I/O 与序列化，未在更外层缓存或复用结果"。这指向一个轻量的架构改进方向——在 run/request 生命周期开始时构造一次只读上下文（catalog、index、预序列化字节、overlay payload），通过参数显式向下透传——比一次性优化某个点更能治本，也与 ACC 追求轻量、健壮的总体目标一致。
