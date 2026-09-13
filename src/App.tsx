import { useEffect, useMemo, useState } from 'react'
import { ListTodo, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

type Task = {
  id: string
  text: string
  done: boolean
}

const STORAGE_KEY = 'nyaa-today-tasks'

function todayLabel() {
  return new Date().toLocaleDateString('ko-KR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function loadTasks(): { tasks: Task[]; error: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { tasks: [], error: null }
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return { tasks: [], error: null }
    }
    const tasks = parsed.filter(
      (item): item is Task =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Task).id === 'string' &&
        typeof (item as Task).text === 'string' &&
        typeof (item as Task).done === 'boolean',
    )
    return { tasks, error: null }
  } catch {
    return {
      tasks: [],
      error: '저장한 목록을 읽지 못했어요. 브라우저가 로컬 저장소를 막았을 수 있어요.',
    }
  }
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [draft, setDraft] = useState('')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateLabel] = useState(todayLabel)

  useEffect(() => {
    const loaded = loadTasks()
    setTasks(loaded.tasks)
    setError(loaded.error)
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) {
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
      setError(null)
    } catch {
      setError('지금 목록을 저장하지 못했어요. 시크릿 창이거나 저장 공간이 가득 찼을 수 있어요.')
    }
  }, [ready, tasks])

  const remaining = useMemo(() => tasks.filter((task) => !task.done).length, [tasks])
  const completed = tasks.length - remaining

  function addTask() {
    const text = draft.trim()
    if (!text) {
      return
    }
    setTasks((current) => [
      { id: crypto.randomUUID(), text, done: false },
      ...current,
    ])
    setDraft('')
  }

  function toggleTask(id: string, done: boolean) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, done } : task)),
    )
  }

  function removeTask(id: string) {
    setTasks((current) => current.filter((task) => task.id !== id))
  }

  function clearCompleted() {
    setTasks((current) => current.filter((task) => !task.done))
  }

  return (
    <div className="min-h-svh bg-muted/40">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6 md:py-12">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary">Nyaa</p>
            <h1 className="font-heading text-3xl tracking-tight md:text-4xl">
              오늘의 할 일
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              짧게 적고, 끝나면 체크하세요. 할 일은 이 브라우저에만 저장되고 서버로는
              나가지 않습니다.
            </p>
          </div>
          <p className="text-sm text-muted-foreground md:text-right">{dateLabel}</p>
        </header>

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.9fr)]">
          <Card className="bg-card">
            <CardHeader className="border-b">
              <CardTitle>할 일 추가</CardTitle>
              <CardDescription>
                한 줄이면 충분해요. 엔터를 눌러도 추가됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault()
                  addTask()
                }}
              >
                <label className="sr-only" htmlFor="task-input">
                  할 일
                </label>
                <Input
                  id="task-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="예: 장 보고, 저녁 준비하기"
                  className="h-11 text-base md:h-9"
                  autoComplete="off"
                />
                <Button type="submit" size="lg" className="h-11 sm:h-9 sm:px-4">
                  <Plus data-icon="inline-start" />
                  추가
                </Button>
              </form>

              {!ready ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  목록을 불러오는 중…
                </p>
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center">
                  <ListTodo className="size-8 text-muted-foreground" />
                  <p className="font-medium">아직 할 일이 없어요</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    위에 첫 할 일을 적어 보세요. 새로고침해도 이 컴퓨터의 브라우저에
                    남습니다.
                  </p>
                </div>
              ) : (
                <ul className="divide-y rounded-xl border">
                  {tasks.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-start gap-3 px-3 py-3 sm:items-center"
                    >
                      <Checkbox
                        checked={task.done}
                        onCheckedChange={(value) =>
                          toggleTask(task.id, value === true)
                        }
                        aria-label={`${task.text} 완료 여부`}
                        className="mt-1 sm:mt-0"
                      />
                      <span
                        className={
                          task.done
                            ? 'min-w-0 flex-1 text-sm text-muted-foreground line-through'
                            : 'min-w-0 flex-1 text-sm'
                        }
                      >
                        {task.text}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${task.text} 삭제`}
                        onClick={() => removeTask(task.id)}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="h-fit bg-card">
            <CardHeader>
              <CardTitle>오늘 요약</CardTitle>
              <CardDescription>남은 일과 끝낸 일을 한눈에 보세요.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="secondary">남은 일 {remaining}개</Badge>
              <Badge variant="outline">완료 {completed}개</Badge>
              <Badge variant="ghost">전체 {tasks.length}개</Badge>
            </CardContent>
            <CardFooter className="justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                끝낸 항목만 지울 수 있어요.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={completed === 0}
                onClick={clearCompleted}
              >
                완료 항목 지우기
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
}
