import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Check,
  Plus,
  Trash2,
  ListTodo,
  Loader2,
  Calendar as CalendarIcon,
  Flag,
  X,
  Tag,
  Sparkles,
  ListFilter,
  BarChart3,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { userSupabase as supabase } from "@/integrations/supabase/user-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Todo — Задачи, календарь, статистика" },
      { name: "description", content: "Планировщик задач с календарём и статистикой." },
      { property: "og:title", content: "Todo — Задачи, календарь, статистика" },
      { property: "og:description", content: "Планировщик задач с календарём и статистикой." },
    ],
  }),
  component: Index,
});

type Priority = "low" | "medium" | "high";

type Category = { id: string; name: string; color: string };

type Task = {
  id: string;
  title: string;
  is_completed: boolean;
  deadline: string | null;
  priority: Priority | null;
  category_id: string | null;
  created_at?: string | null;
};

type View = "list" | "calendar" | "stats";

const PRIORITY_LEAD_MS: Record<Priority, number> = {
  low: 15 * 60 * 1000,
  medium: 45 * 60 * 1000,
  high: 90 * 60 * 1000,
};

const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  low:    { label: "Низкий",  color: "text-sky-400",   bg: "bg-sky-400" },
  medium: { label: "Средний", color: "text-amber-400", bg: "bg-amber-400" },
  high:   { label: "Высокий", color: "text-rose-400",  bg: "bg-rose-400" },
};

const PRIORITY_OPTIONS: { value: Priority | null; label: string; color: string }[] = [
  { value: "high", label: "Высокий", color: "text-rose-400" },
  { value: "medium", label: "Средний", color: "text-amber-400" },
  { value: "low", label: "Низкий", color: "text-sky-400" },
  { value: null, label: "Без приоритета", color: "text-muted-foreground" },
];

const PRESET_COLORS = ["#f97316", "#8b5cf6", "#06b6d4", "#22c55e", "#ec4899", "#eab308"];

function Index() {
  const [view, setView] = useState<View>("list");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority | null>(null);
  const [categoryId, setCategoryId] = useState<string | "">("");
  const [filterCat, setFilterCat] = useState<string | "all">("all");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCatManager, setShowCatManager] = useState(false);
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const visibleTasks = useMemo(
    () => (filterCat === "all" ? tasks : tasks.filter((t) => t.category_id === filterCat)),
    [tasks, filterCat],
  );
  const remaining = visibleTasks.filter((t) => !t.is_completed).length;
  const catById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );
  const parsedPreview = useMemo(
    () => (draft.trim() && !deadline ? parseTitleTime(draft) : null),
    [draft, deadline],
  );

  useEffect(() => {
    (async () => {
      const [{ data: t, error: te }, { data: c, error: ce }] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, title, is_completed, deadline, priority, category_id, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("categories").select("id, name, color").order("created_at"),
      ]);
      if (te) setError(te.message);
      else setTasks((t ?? []) as Task[]);
      if (ce) setError(ce.message);
      else setCategories((c ?? []) as Category[]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const timers: number[] = [];
    const now = Date.now();
    for (const t of tasks) {
      if (!t.deadline || t.is_completed || !t.priority) continue;
      const lead = PRIORITY_LEAD_MS[t.priority];
      const fireAt = new Date(t.deadline).getTime() - lead;
      const delay = fireAt - now;
      if (delay <= 0 || delay > 2_147_000_000) continue;
      const id = window.setTimeout(() => {
        if (Notification.permission === "granted") {
          const minutes = Math.round(lead / 60000);
          const when =
            minutes >= 60
              ? `${Math.floor(minutes / 60)} ч ${minutes % 60 ? `${minutes % 60} мин` : ""}`.trim()
              : `${minutes} минут`;
          new Notification("Напоминание", {
            body: `${t.title} истекает через ${when}!`,
            tag: `task-${t.id}`,
          });
        }
      }, delay);
      timers.push(id);
    }
    return () => timers.forEach((id) => clearTimeout(id));
  }, [tasks]);

  async function addTask(e: FormEvent) {
    e.preventDefault();
    const raw = draft.trim();
    if (!raw) return;
    const parsed = parseTitleTime(raw);
    const title = (parsed.cleanTitle || raw).trim();
    const finalDeadline = deadline
      ? new Date(deadline).toISOString()
      : parsed.deadline
        ? parsed.deadline.toISOString()
        : null;
    setAdding(true);
    const payload = {
      title,
      is_completed: false,
      deadline: finalDeadline,
      priority,
      category_id: categoryId || null,
    };
    const { data, error } = await supabase
      .from("tasks")
      .insert(payload)
      .select("id, title, is_completed, deadline, priority, category_id, created_at")
      .single();
    setAdding(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data) {
      setTasks((prev) => [data as Task, ...prev]);
      setDraft("");
      setDeadline("");
      setPriority(null);
      setCategoryId("");
    }
  }

  async function toggle(task: Task) {
    const next = !task.is_completed;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, is_completed: next } : t)),
    );
    const { error } = await supabase
      .from("tasks")
      .update({ is_completed: next })
      .eq("id", task.id);
    if (error) {
      setError(error.message);
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, is_completed: !next } : t)),
      );
    }
  }

  async function changePriority(task: Task, next: Priority | null) {
    if (task.priority === next) return;
    const prev = task.priority;
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, priority: next } : t)));
    const { error } = await supabase.from("tasks").update({ priority: next }).eq("id", task.id);
    if (error) {
      setError(error.message);
      setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, priority: prev } : t)));
    }
  }

  async function changeCategory(task: Task, next: string | null) {
    if (task.category_id === next) return;
    const prev = task.category_id;
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, category_id: next } : t)));
    const { error } = await supabase.from("tasks").update({ category_id: next }).eq("id", task.id);
    if (error) {
      setError(error.message);
      setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, category_id: prev } : t)));
    }
  }

  async function updateTask(id: string, patch: Partial<Task>) {
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) {
      setError(error.message);
      setTasks(prev);
    }
  }

  async function remove(task: Task) {
    setRemoving((s) => new Set(s).add(task.id));
    await new Promise((r) => setTimeout(r, 280));
    const prev = tasks;
    setTasks((cur) => cur.filter((t) => t.id !== task.id));
    setRemoving((s) => {
      const n = new Set(s);
      n.delete(task.id);
      return n;
    });
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) {
      setError(error.message);
      setTasks(prev);
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    const name = newCatName.trim();
    if (!name) return;
    const { data, error } = await supabase
      .from("categories")
      .insert({ name, color: newCatColor })
      .select("id, name, color")
      .single();
    if (error) return setError(error.message);
    if (data) {
      setCategories((prev) => [...prev, data as Category]);
      setNewCatName("");
    }
  }

  async function removeCategory(id: string) {
    const prev = categories;
    setCategories((c) => c.filter((x) => x.id !== id));
    setTasks((ts) => ts.map((t) => (t.category_id === id ? { ...t, category_id: null } : t)));
    if (filterCat === id) setFilterCat("all");
    if (categoryId === id) setCategoryId("");
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) {
      setError(error.message);
      setCategories(prev);
    }
  }

  const editingTask = editingId ? tasks.find((t) => t.id === editingId) ?? null : null;

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 20% 0%, oklch(0.35 0.15 295 / 0.35), transparent 60%), radial-gradient(ellipse 50% 40% at 90% 20%, oklch(0.4 0.14 200 / 0.28), transparent 60%), radial-gradient(ellipse 80% 60% at 50% 100%, oklch(0.25 0.08 280 / 0.4), transparent 60%)",
        }}
      />
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex items-center gap-3 animate-task-in">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/40">
            <ListTodo className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Мои задачи</h1>
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Загрузка…"
                : view === "list"
                  ? remaining === 0
                    ? visibleTasks.length === 0
                      ? <span className="inline-flex items-center gap-1.5 text-primary"><Sparkles className="h-3.5 w-3.5" /> Начните с первой задачи ниже ↓</span>
                      : "Всё сделано — отличная работа!"
                    : `Осталось ${remaining} ${pluralize(remaining)}`
                  : view === "calendar"
                    ? "Задачи по датам — кликните, чтобы отредактировать"
                    : "Прогресс и статистика за неделю"}
            </p>
          </div>
          {view === "list" && (
            <button
              onClick={() => setShowCatManager((v) => !v)}
              title="Управлять категориями"
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm backdrop-blur-xl transition hover:-translate-y-0.5 ${
                showCatManager
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-border bg-card/60 text-foreground hover:border-primary/40 hover:bg-card/80"
              }`}
            >
              <Tag className="h-4 w-4" /> Категории
            </button>
          )}
        </header>

        {/* Tabs */}
        <div className="mb-6 inline-flex w-full items-center gap-1 rounded-2xl border border-border bg-card/50 backdrop-blur-xl p-1 shadow-lg animate-task-in">
          <TabButton active={view === "list"} onClick={() => setView("list")} icon={<ListTodo className="h-4 w-4" />}>
            Список задач
          </TabButton>
          <TabButton active={view === "calendar"} onClick={() => setView("calendar")} icon={<CalendarIcon className="h-4 w-4" />}>
            Календарь
          </TabButton>
          <TabButton active={view === "stats"} onClick={() => setView("stats")} icon={<BarChart3 className="h-4 w-4" />}>
            Статистика
          </TabButton>
        </div>

        {error && (
          <p className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive animate-task-in">
            {error}
          </p>
        )}

        {view === "list" && (
          <ListView
            tasks={tasks}
            visibleTasks={visibleTasks}
            categories={categories}
            catById={catById}
            loading={loading}
            adding={adding}
            draft={draft}
            setDraft={setDraft}
            deadline={deadline}
            setDeadline={setDeadline}
            priority={priority}
            setPriority={setPriority}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            parsedPreview={parsedPreview}
            addTask={addTask}
            toggle={toggle}
            remove={remove}
            removing={removing}
            filterCat={filterCat}
            setFilterCat={setFilterCat}
            showCatManager={showCatManager}
            newCatName={newCatName}
            setNewCatName={setNewCatName}
            newCatColor={newCatColor}
            setNewCatColor={setNewCatColor}
            addCategory={addCategory}
            removeCategory={removeCategory}
            openPickerId={openPickerId}
            setOpenPickerId={setOpenPickerId}
            changePriority={changePriority}
            changeCategory={changeCategory}
          />
        )}

        {view === "calendar" && (
          <CalendarView tasks={tasks} catById={catById} onOpenTask={(id) => setEditingId(id)} />
        )}

        {view === "stats" && <StatsView tasks={tasks} />}
      </div>

      {editingTask && (
        <EditModal
          task={editingTask}
          categories={categories}
          onClose={() => setEditingId(null)}
          onSave={async (patch) => {
            await updateTask(editingTask.id, patch);
            setEditingId(null);
          }}
          onDelete={async () => {
            const t = editingTask;
            setEditingId(null);
            await remove(t);
          }}
        />
      )}
    </main>
  );
}

function TabButton({
  children,
  active,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-all ${
        active
          ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md shadow-primary/40"
          : "text-muted-foreground hover:bg-background/40 hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/* --------------------------------- LIST VIEW --------------------------------- */

type ListViewProps = {
  tasks: Task[];
  visibleTasks: Task[];
  categories: Category[];
  catById: Record<string, Category>;
  loading: boolean;
  adding: boolean;
  draft: string;
  setDraft: (v: string) => void;
  deadline: string;
  setDeadline: (v: string) => void;
  priority: Priority | null;
  setPriority: (p: Priority | null) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  parsedPreview: ParseResult | null;
  addTask: (e: FormEvent) => void;
  toggle: (t: Task) => void;
  remove: (t: Task) => void;
  removing: Set<string>;
  filterCat: string | "all";
  setFilterCat: (v: string | "all") => void;
  showCatManager: boolean;
  newCatName: string;
  setNewCatName: (v: string) => void;
  newCatColor: string;
  setNewCatColor: (v: string) => void;
  addCategory: (e: FormEvent) => void;
  removeCategory: (id: string) => void;
  openPickerId: string | null;
  setOpenPickerId: (v: string | null) => void;
  changePriority: (t: Task, p: Priority | null) => void;
  changeCategory: (t: Task, c: string | null) => void;
};

function ListView(p: ListViewProps) {
  return (
    <>
      {p.showCatManager && (
        <div className="mb-6 rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-4 shadow-lg animate-task-in">
          <div className="mb-3 flex flex-wrap gap-2">
            {p.categories.map((c) => (
              <span
                key={c.id}
                className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-background/50 pl-2 pr-1 py-1 text-xs"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                {c.name}
                <button
                  onClick={() => p.removeCategory(c.id)}
                  className="ml-1 rounded-full p-0.5 text-muted-foreground transition hover:bg-destructive/20 hover:text-destructive"
                  aria-label={`Удалить ${c.name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {p.categories.length === 0 && (
              <span className="text-xs text-muted-foreground">Нет категорий</span>
            )}
          </div>
          <form onSubmit={p.addCategory} className="flex flex-wrap items-center gap-2">
            <input
              value={p.newCatName}
              onChange={(e) => p.setNewCatName(e.target.value)}
              placeholder="Новая категория"
              className="flex-1 min-w-[140px] rounded-lg border border-border bg-background/50 px-3 py-1.5 text-sm outline-none focus:border-primary/50"
            />
            <div className="flex flex-wrap gap-1">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => p.setNewCatColor(color)}
                  title={`Выбрать цвет ${color}`}
                  className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition hover:scale-110 ${
                    p.newCatColor === color ? "ring-2 ring-foreground" : ""
                  }`}
                  style={{ background: color }}
                  aria-label={`Цвет ${color}`}
                />
              ))}
            </div>
            <button
              type="submit"
              disabled={!p.newCatName.trim()}
              className="inline-flex items-center gap-1 rounded-lg bg-primary/90 px-3 py-1.5 text-sm text-primary-foreground transition hover:bg-primary disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Добавить
            </button>
          </form>
        </div>
      )}

      <form
        onSubmit={p.addTask}
        className="relative rounded-3xl border-2 border-primary/30 bg-card/70 backdrop-blur-xl p-4 shadow-2xl shadow-primary/20 focus-within:border-primary/70 focus-within:shadow-primary/30 transition-all"
      >
        <div className="pointer-events-none absolute -top-3 left-4 flex items-center gap-1 rounded-full bg-gradient-to-r from-primary to-accent px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground shadow-md">
          <Sparkles className="h-3 w-3" /> Новая задача
        </div>
        <div className="flex items-center gap-2">
          <input
            value={p.draft}
            onChange={(e) => p.setDraft(e.target.value)}
            placeholder='Напр.: "Позвонить маме 25 декабря в 18:00" — дата и время подхватятся'
            title="Введите название задачи. Слова о времени и дате станут дедлайном."
            className="flex-1 bg-transparent px-3 py-3 text-base text-foreground placeholder:text-muted-foreground outline-none"
            aria-label="Новая задача"
            autoFocus
          />
          <button
            type="submit"
            disabled={!p.draft.trim() || p.adding}
            title="Добавить задачу в список"
            className="inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-primary to-accent px-5 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/40 transition-all hover:shadow-primary/60 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:translate-y-0"
          >
            {p.adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Добавить
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
          <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary">Опции</span>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-2 py-1 text-xs text-muted-foreground focus-within:border-primary/50">
            <CalendarIcon className="h-3.5 w-3.5" />
            <input
              type="datetime-local"
              value={p.deadline}
              onChange={(e) => p.setDeadline(e.target.value)}
              className="bg-transparent text-xs text-foreground outline-none [color-scheme:dark]"
            />
          </label>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-2 py-1 text-xs">
            <Flag className={`h-3.5 w-3.5 ${p.priority ? PRIORITY_META[p.priority].color : "text-muted-foreground"}`} />
            <select
              value={p.priority ?? ""}
              onChange={(e) => p.setPriority((e.target.value || null) as Priority | null)}
              className="bg-transparent text-xs text-foreground outline-none"
            >
              <option value="">Без приоритета</option>
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-2 py-1 text-xs">
            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={p.categoryId}
              onChange={(e) => p.setCategoryId(e.target.value)}
              className="bg-transparent text-xs text-foreground outline-none"
            >
              <option value="">Без категории</option>
              {p.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
        {p.parsedPreview?.deadline && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300 animate-task-in">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              Распознано: <b className="font-semibold">{formatDeadline(p.parsedPreview.deadline.toISOString())}</b>
              {p.parsedPreview.cleanTitle && p.parsedPreview.cleanTitle !== p.draft.trim() && (
                <> · название: «{p.parsedPreview.cleanTitle}»</>
              )}
            </span>
          </div>
        )}
        {p.parsedPreview?.ambiguous && !p.parsedPreview.deadline && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300 animate-task-in">
            <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Не удалось распознать дату/время. Попробуйте: «в 18:00», «завтра в 9», «25 декабря», «25.12 в 15:30», «через 2 часа».
            </span>
          </div>
        )}
      </form>

      {p.categories.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-primary"><ListFilter className="h-3 w-3" /> Фильтр</span>
          <FilterChip active={p.filterCat === "all"} onClick={() => p.setFilterCat("all")}>Все</FilterChip>
          {p.categories.map((c) => (
            <FilterChip
              key={c.id}
              active={p.filterCat === c.id}
              onClick={() => p.setFilterCat(c.id)}
              color={c.color}
            >
              {c.name}
            </FilterChip>
          ))}
        </div>
      )}

      <ul className="mt-6 space-y-2">
        {p.loading && (
          <li className="flex items-center justify-center rounded-2xl border border-dashed border-border p-10 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загрузка задач…
          </li>
        )}
        {!p.loading && p.visibleTasks.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border p-10 text-center animate-task-in">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ListTodo className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-foreground">Пока пусто</p>
            <p className="mt-1 text-xs text-muted-foreground">Добавьте первую задачу в форме выше</p>
          </li>
        )}
        {p.visibleTasks.map((task) => {
          const isRemoving = p.removing.has(task.id);
          const cat = task.category_id ? p.catById[task.category_id] : null;
          const overdue =
            task.deadline && !task.is_completed && new Date(task.deadline) < new Date();
          return (
            <li
              key={task.id}
              className={`group flex items-start gap-3 rounded-2xl border border-border bg-card/60 backdrop-blur-xl px-3 py-3 shadow-lg shadow-black/10 transition-all duration-300 hover:border-primary/50 hover:bg-card/80 hover:shadow-primary/20 hover:-translate-y-0.5 ${
                isRemoving ? "animate-task-out" : "animate-task-in"
              } ${task.is_completed ? "opacity-70" : ""}`}
            >
              <button
                onClick={() => p.toggle(task)}
                title={task.is_completed ? "Снять отметку выполнено" : "Отметить выполненной"}
                aria-label={task.is_completed ? "Снять отметку" : "Отметить выполненным"}
                className={`relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                  task.is_completed
                    ? "border-primary bg-gradient-to-br from-primary to-accent text-primary-foreground"
                    : "border-border hover:border-primary hover:scale-110"
                }`}
              >
                {task.is_completed && (
                  <Check className="h-3.5 w-3.5 animate-check-pop" strokeWidth={3} />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <span
                  className={`block text-sm transition-all duration-300 ${
                    task.is_completed
                      ? "text-muted-foreground line-through decoration-primary/60"
                      : "text-foreground"
                  }`}
                >
                  {task.title}
                </span>
                <div
                  className={`mt-1 flex flex-wrap items-center gap-1.5 text-xs transition ${
                    task.is_completed ? "opacity-50 grayscale" : ""
                  }`}
                >
                  <PriorityPicker
                    value={task.priority}
                    onChange={(pri) => p.changePriority(task, pri)}
                    isOpen={p.openPickerId === `${task.id}:pri`}
                    setOpen={(open) => p.setOpenPickerId(open ? `${task.id}:pri` : null)}
                  />
                  <CategoryPicker
                    value={cat}
                    categories={p.categories}
                    onChange={(c) => p.changeCategory(task, c)}
                    isOpen={p.openPickerId === `${task.id}:cat`}
                    setOpen={(open) => p.setOpenPickerId(open ? `${task.id}:cat` : null)}
                  />
                  {task.deadline && (
                    <span
                      title={overdue ? "Срок истёк" : "Дедлайн задачи"}
                      className={`inline-flex items-center gap-1 rounded-full bg-background/50 px-2 py-0.5 ${
                        overdue ? "text-rose-400" : "text-muted-foreground"
                      }`}
                    >
                      <CalendarIcon className="h-3 w-3" />
                      {formatDeadline(task.deadline)}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => p.remove(task)}
                title="Удалить задачу"
                aria-label="Удалить"
                className="rounded-lg p-2 text-muted-foreground opacity-60 transition-all hover:bg-destructive/15 hover:text-destructive hover:scale-110 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/* ------------------------------- CALENDAR VIEW ------------------------------- */

function CalendarView({
  tasks,
  catById,
  onOpenTask,
}: {
  tasks: Task[];
  catById: Record<string, Category>;
  onOpenTask: (id: string) => void;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  // Понедельник — первый день недели.
  const startOffset = (monthStart.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + monthEnd.getDate()) / 7) * 7;

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.deadline) continue;
      const d = new Date(t.deadline);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    // sort by time
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());
    }
    return map;
  }, [tasks]);

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  const monthName = cursor.toLocaleString("ru-RU", { month: "long", year: "numeric" });
  const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  return (
    <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-4 shadow-lg animate-task-in">
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          title="Предыдущий месяц"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background/40 text-foreground transition hover:border-primary/50 hover:bg-primary/10"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold capitalize">{monthName}</h2>
          <button
            onClick={() => {
              const n = new Date();
              n.setDate(1);
              n.setHours(0, 0, 0, 0);
              setCursor(n);
            }}
            className="rounded-full border border-border bg-background/40 px-2.5 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            Сегодня
          </button>
        </div>
        <button
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          title="Следующий месяц"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background/40 text-foreground transition hover:border-primary/50 hover:bg-primary/10"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {weekDays.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: totalCells }).map((_, i) => {
          const dayNum = i - startOffset + 1;
          const inMonth = dayNum >= 1 && dayNum <= monthEnd.getDate();
          const cellDate = new Date(year, month, dayNum);
          const key = `${cellDate.getFullYear()}-${cellDate.getMonth()}-${cellDate.getDate()}`;
          const dayTasks = inMonth ? tasksByDay.get(key) ?? [] : [];
          const isToday = inMonth && key === todayKey;
          return (
            <div
              key={i}
              className={`min-h-[92px] rounded-lg border p-1.5 text-left transition ${
                inMonth
                  ? isToday
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/60 bg-background/30 hover:border-primary/30"
                  : "border-transparent bg-transparent"
              }`}
            >
              {inMonth && (
                <>
                  <div className={`mb-1 text-[11px] font-semibold ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                    {dayNum}
                  </div>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 3).map((t) => {
                      const cat = t.category_id ? catById[t.category_id] : null;
                      const color = cat?.color ?? "oklch(0.72 0.19 295)";
                      return (
                        <button
                          key={t.id}
                          onClick={() => onOpenTask(t.id)}
                          title={`${t.title} — ${formatDeadline(t.deadline!)}`}
                          className={`flex w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-left text-[10px] transition hover:brightness-125 ${
                            t.is_completed
                              ? "border-border/50 bg-background/40 text-muted-foreground line-through opacity-70"
                              : "border-border/60 bg-background/60 text-foreground"
                          }`}
                          style={!t.is_completed ? { borderColor: `${color}66`, background: `${color}18` } : undefined}
                        >
                          {t.priority && (
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_META[t.priority].bg}`} />
                          )}
                          <span className="truncate">{t.title}</span>
                        </button>
                      );
                    })}
                    {dayTasks.length > 3 && (
                      <button
                        onClick={() => onOpenTask(dayTasks[3].id)}
                        className="w-full rounded-md px-1.5 py-0.5 text-left text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        +{dayTasks.length - 3} ещё
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------- STATS VIEW -------------------------------- */

function StatsView({ tasks }: { tasks: Task[] }) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.is_completed).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const todayTasks = tasks.filter((t) => {
    const src = t.deadline ?? t.created_at ?? null;
    if (!src) return false;
    const d = new Date(src);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === todayKey;
  });
  const todayDone = todayTasks.filter((t) => t.is_completed).length;
  const todayPct = todayTasks.length ? Math.round((todayDone / todayTasks.length) * 100) : 0;

  // Неделя: понедельник — воскресенье, по created_at выполненных задач.
  const startOfWeek = new Date(today);
  const dow = (startOfWeek.getDay() + 6) % 7; // 0 = Пн
  startOfWeek.setDate(startOfWeek.getDate() - dow);
  startOfWeek.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });
  const weekLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const counts = days.map((day) => {
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    return tasks.filter((t) => {
      if (!t.is_completed) return false;
      const src = t.created_at ?? t.deadline ?? null;
      if (!src) return false;
      const d = new Date(src);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === key;
    }).length;
  });
  const maxCount = Math.max(1, ...counts);
  const todayIdx = (today.getDay() + 6) % 7;

  return (
    <div className="space-y-4 animate-task-in">
      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-lg">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Прогресс за всё время</h2>
          <span className="text-2xl font-bold text-foreground">
            {done}<span className="text-muted-foreground">/{total}</span>
          </span>
        </div>
        <ProgressBar value={pct} />
        <p className="mt-2 text-xs text-muted-foreground">{pct}% задач выполнено</p>
      </div>

      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-lg">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Сегодня</h2>
          <span className="text-2xl font-bold text-foreground">
            {todayDone}<span className="text-muted-foreground">/{todayTasks.length}</span>
          </span>
        </div>
        <ProgressBar value={todayPct} />
        <p className="mt-2 text-xs text-muted-foreground">
          {todayTasks.length === 0
            ? "На сегодня задач нет"
            : `${todayPct}% сегодняшних задач выполнено`}
        </p>
      </div>

      <div className="rounded-3xl border border-border bg-card/60 backdrop-blur-xl p-5 shadow-lg">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Выполнено за неделю</h2>
          <span className="text-xs text-muted-foreground">
            {startOfWeek.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })} —{" "}
            {days[6].toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
          </span>
        </div>
        <div className="flex items-end justify-between gap-2 h-40">
          {counts.map((c, i) => {
            const h = (c / maxCount) * 100;
            const isToday = i === todayIdx;
            return (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="relative flex w-full flex-1 items-end">
                  <div
                    className={`relative w-full rounded-t-md transition-all duration-500 ${
                      isToday
                        ? "bg-gradient-to-t from-primary to-accent shadow-lg shadow-primary/40"
                        : "bg-gradient-to-t from-primary/40 to-accent/40"
                    }`}
                    style={{ height: `${c === 0 ? 4 : h}%`, minHeight: c === 0 ? 4 : 8 }}
                    title={`${weekLabels[i]}: ${c} задач`}
                  >
                    {c > 0 && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-foreground">
                        {c}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`text-[11px] ${isToday ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                  {weekLabels[i]}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Учитываются задачи, отмеченные как выполненные, по дате создания.
        </p>
      </div>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-background/50">
      <div
        className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-700"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* --------------------------------- EDIT MODAL -------------------------------- */

function EditModal({
  task,
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task;
  categories: Category[];
  onClose: () => void;
  onSave: (patch: Partial<Task>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [deadline, setDeadline] = useState(task.deadline ? toLocalInput(task.deadline) : "");
  const [priority, setPriority] = useState<Priority | null>(task.priority);
  const [categoryId, setCategoryId] = useState<string>(task.category_id ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    await onSave({
      title: title.trim(),
      deadline: deadline ? new Date(deadline).toISOString() : null,
      priority,
      category_id: categoryId || null,
    });
    setSaving(false);
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4 animate-task-in"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="w-full max-w-md rounded-3xl border-2 border-primary/40 bg-card/95 backdrop-blur-xl p-5 shadow-2xl shadow-primary/30"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Редактировать задачу</h3>
          <button
            type="button"
            onClick={onClose}
            title="Закрыть"
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-background/50 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Название</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-4 w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/60"
          autoFocus
        />

        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Дедлайн</label>
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="mb-4 w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/60 [color-scheme:dark]"
        />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Приоритет</label>
            <select
              value={priority ?? ""}
              onChange={(e) => setPriority((e.target.value || null) as Priority | null)}
              className="w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/60"
            >
              <option value="">Без приоритета</option>
              <option value="low">Низкий</option>
              <option value="medium">Средний</option>
              <option value="high">Высокий</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Категория</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/60"
            >
              <option value="">Без категории</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDelete}
            title="Удалить задачу"
            className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive transition hover:bg-destructive/20"
          >
            <Trash2 className="h-4 w-4" /> Удалить
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/40 transition hover:shadow-primary/60 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* -------------------------------- SHARED UI ---------------------------------- */

function FilterChip({
  children,
  active,
  onClick,
  color,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
        active
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border bg-card/40 text-muted-foreground hover:text-foreground"
      }`}
    >
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

function PriorityPicker({
  value,
  onChange,
  isOpen,
  setOpen,
}: {
  value: Priority | null;
  onChange: (p: Priority | null) => void;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [isOpen, setOpen]);

  return (
    <span className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {value ? (
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          className={`inline-flex items-center gap-1 rounded-full bg-background/50 px-2 py-0.5 transition hover:bg-background/80 ${PRIORITY_META[value].color}`}
        >
          <Flag className="h-3 w-3" />
          {PRIORITY_META[value].label}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          title="Задать приоритет"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-muted-foreground transition hover:border-primary/60 hover:bg-primary/5 hover:text-foreground"
        >
          <Flag className="h-3 w-3" /> Без приоритета
        </button>
      )}
      {isOpen && (
        <div className="absolute left-0 bottom-full z-50 mb-1 min-w-[160px] overflow-hidden rounded-xl border border-border bg-popover/95 backdrop-blur-xl shadow-xl animate-task-in">
          {PRIORITY_OPTIONS.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-primary/10 ${o.color} ${
                value === o.value ? "bg-primary/5" : ""
              }`}
            >
              {o.value ? <Flag className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {o.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function CategoryPicker({
  value,
  categories,
  onChange,
  isOpen,
  setOpen,
}: {
  value: Category | null;
  categories: Category[];
  onChange: (id: string | null) => void;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [isOpen, setOpen]);

  return (
    <span className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {value ? (
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          className="inline-flex items-center gap-1 rounded-full bg-background/50 px-2 py-0.5 text-foreground/80 transition hover:bg-background/80"
          style={{ boxShadow: `inset 0 0 0 1px ${value.color}55` }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: value.color }} />
          {value.name}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(!isOpen)}
          title="Выбрать категорию"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-muted-foreground transition hover:border-primary/60 hover:bg-primary/5 hover:text-foreground"
        >
          <Tag className="h-3 w-3" /> Без категории
        </button>
      )}
      {isOpen && (
        <div className="absolute left-0 bottom-full z-50 mb-1 min-w-[170px] max-h-56 overflow-auto rounded-xl border border-border bg-popover/95 backdrop-blur-xl shadow-xl animate-task-in">
          {categories.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Нет категорий</div>
          )}
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition hover:bg-primary/10 ${
                value?.id === c.id ? "bg-primary/5" : ""
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={`flex w-full items-center gap-2 border-t border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-primary/10 ${
              value === null ? "bg-primary/5" : ""
            }`}
          >
            <X className="h-3 w-3" /> Без категории
          </button>
        </div>
      )}
    </span>
  );
}

function formatDeadline(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* --------------------------------- PARSING ----------------------------------- */

type ParseResult = {
  cleanTitle: string;
  deadline: Date | null;
  ambiguous: boolean;
};

const MONTHS: Record<string, number> = {
  "янв": 0, "января": 0, "январь": 0,
  "фев": 1, "февраля": 1, "февраль": 1,
  "мар": 2, "марта": 2, "март": 2,
  "апр": 3, "апреля": 3, "апрель": 3,
  "май": 4, "мая": 4,
  "июн": 5, "июня": 5, "июнь": 5,
  "июл": 6, "июля": 6, "июль": 6,
  "авг": 7, "августа": 7, "август": 7,
  "сен": 8, "сентября": 8, "сентябрь": 8,
  "окт": 9, "октября": 9, "октябрь": 9,
  "ноя": 10, "ноября": 10, "ноябрь": 10,
  "дек": 11, "декабря": 11, "декабрь": 11,
};
const MONTHS_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

/**
 * Ищет упоминания времени и/или даты:
 *   "через 2 часа", "через час", "через 30 минут", "через полчаса"
 *   "(сегодня|завтра|послезавтра)? в HH[:MM] (утра|дня|вечера|ночи)?"
 *   "25 декабря", "25 дек в 18:00", "25.12", "25.12.2026 в 9:00", "25/12"
 */
function parseTitleTime(input: string): ParseResult {
  let working = input;
  let matched = false;
  let dateOnly: { y: number; m: number; d: number } | null = null;
  let timeOnly: { h: number; min: number } | null = null;
  let dayShift: number | null = null; // 0/1/2 для сегодня/завтра/послезавтра
  let relative: Date | null = null; // «через …»

  // 1) «через N часов/минут/полчаса»
  const reIn = /(?:^|\s)через\s+(?:(\d+)\s+)?(полчаса|час(?:а|ов)?|минут(?:у|ы)?)(?=\s|[.,!?]|$)/i;
  const mIn = working.match(reIn);
  if (mIn) {
    const n = mIn[1] ? parseInt(mIn[1], 10) : 1;
    const unit = mIn[2].toLowerCase();
    let ms = 0;
    if (unit === "полчаса") ms = 30 * 60 * 1000;
    else if (unit.startsWith("час")) ms = n * 60 * 60 * 1000;
    else ms = n * 60 * 1000;
    relative = new Date(Date.now() + ms);
    relative.setSeconds(0, 0);
    working = working.replace(reIn, " ");
    matched = true;
  }

  if (!relative) {
    // 2) Дата в форматах «DD.MM(.YYYY)?» / «DD/MM(/YYYY)?»
    const reNumDate = /(?:^|\s)(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?(?=\s|[.,!?]|$)/;
    const mNum = working.match(reNumDate);
    if (mNum) {
      const d = parseInt(mNum[1], 10);
      const m = parseInt(mNum[2], 10) - 1;
      let y = mNum[3] ? parseInt(mNum[3], 10) : new Date().getFullYear();
      if (y < 100) y += 2000;
      if (d >= 1 && d <= 31 && m >= 0 && m <= 11) {
        dateOnly = { y, m, d };
        working = working.replace(reNumDate, " ");
        matched = true;
      }
    }

    // 3) Дата в форматах «DD месяц(а)» — «25 декабря», «5 мая»
    if (!dateOnly) {
      const reWordDate = new RegExp(
        `(?:^|\\s)(\\d{1,2})\\s+(${MONTHS_ALT})(?=\\s|[.,!?]|$)`,
        "i",
      );
      const mWord = working.match(reWordDate);
      if (mWord) {
        const d = parseInt(mWord[1], 10);
        const m = MONTHS[mWord[2].toLowerCase()];
        if (d >= 1 && d <= 31 && m !== undefined) {
          dateOnly = { y: new Date().getFullYear(), m, d };
          working = working.replace(reWordDate, " ");
          matched = true;
        }
      }
    }

    // 4) «сегодня|завтра|послезавтра» (сдвиг относительно сегодняшнего дня)
    if (!dateOnly) {
      const reDay = /(?:^|\s)(сегодня|завтра|послезавтра)(?=\s|[.,!?]|$)/i;
      const mDay = working.match(reDay);
      if (mDay) {
        const map: Record<string, number> = { "сегодня": 0, "завтра": 1, "послезавтра": 2 };
        dayShift = map[mDay[1].toLowerCase()];
        working = working.replace(reDay, " ");
        matched = true;
      }
    }

    // 5) «в HH[:MM] (утра|дня|вечера|ночи)?»
    const reTime =
      /(?:^|\s)в\s+(\d{1,2})(?::(\d{2}))?(?:\s+(утра|вечера|дня|ночи))?(?=\s|[.,!?]|$)/i;
    const mTime = working.match(reTime);
    if (mTime) {
      let h = parseInt(mTime[1], 10);
      const min = mTime[2] ? parseInt(mTime[2], 10) : 0;
      const part = mTime[3]?.toLowerCase();
      if (h <= 23 && min <= 59) {
        if (part === "вечера" && h < 12) h += 12;
        else if (part === "дня" && h < 12 && h >= 1) h += 12;
        else if ((part === "ночи" || part === "утра") && h === 12) h = 0;
        timeOnly = { h, min };
        working = working.replace(reTime, " ");
        matched = true;
      }
    }
  }

  if (matched) {
    let d: Date;
    if (relative) {
      d = relative;
    } else {
      const now = new Date();
      d = new Date(now);
      d.setSeconds(0, 0);
      if (dateOnly) {
        d.setFullYear(dateOnly.y, dateOnly.m, dateOnly.d);
      } else if (dayShift !== null) {
        d.setDate(d.getDate() + dayShift);
      }
      if (timeOnly) {
        d.setHours(timeOnly.h, timeOnly.min, 0, 0);
        // если время сегодня уже прошло и день явно не указан — на завтра
        if (!dateOnly && dayShift === null && d.getTime() <= now.getTime()) {
          d.setDate(d.getDate() + 1);
        }
      } else if (dateOnly || dayShift !== null) {
        // если дата без времени — 09:00 по умолчанию
        d.setHours(9, 0, 0, 0);
      }
    }
    const cleanTitle = working.replace(/\s+/g, " ").trim();
    return { cleanTitle, deadline: d, ambiguous: false };
  }

  const hasHint =
    /(?:^|\s)(?:через|в\s+\d|сегодня|завтра|послезавтра|\d{1,2}[.\/]\d{1,2}|\d{1,2}\s+(?:янв|фев|мар|апр|май|мая|июн|июл|авг|сен|окт|ноя|дек))/i.test(
      input,
    );
  return { cleanTitle: input, deadline: null, ambiguous: hasHint };
}

function pluralize(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "задача";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "задачи";
  return "задач";
}
