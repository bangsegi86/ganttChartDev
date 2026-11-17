import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { Button } from '@/shared/ui/Button';

/**
 * In-app user guide (F1 / 도움말 button). Plain-language, task-oriented
 * sections so people can find "how do I …" without outside documentation.
 */
export type HelpSection =
  | 'start' | 'edit' | 'schedule' | 'paste' | 'view' | 'file' | 'keys';

const SECTIONS: { id: HelpSection; title: string }[] = [
  { id: 'start', title: '처음 시작하기' },
  { id: 'edit', title: '작업 만들고 고치기' },
  { id: 'schedule', title: '일정 막대와 연결' },
  { id: 'paste', title: '엑셀에서 붙여넣기' },
  { id: 'view', title: '화면과 보기' },
  { id: 'file', title: '저장과 내보내기' },
  { id: 'keys', title: '단축키 모음' },
];

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
  initialSection?: HelpSection;
}

export function HelpDialog({ open, onClose, initialSection = 'start' }: HelpDialogProps) {
  const [section, setSection] = useState<HelpSection>(initialSection);
  useEffect(() => { if (open) setSection(initialSection); }, [open, initialSection]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="도움말"
      width={820}
      footer={<Button size="sm" onClick={onClose}>닫기</Button>}
    >
      <div className="flex h-[min(60vh,560px)] gap-4">
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border pr-3" aria-label="도움말 목차">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                section === s.id ? 'bg-accent/15 font-semibold text-accent' : 'text-content hover:bg-surface-3'
              }`}
            >
              {s.title}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto pr-1 text-xs leading-relaxed text-content">
          {CONTENT[section]}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function H({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-4 text-sm font-semibold text-content first:mt-0">{children}</h3>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-content-muted">{children}</p>;
}
function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mb-3 flex flex-col gap-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-2xs font-semibold text-accent">
            {i + 1}
          </span>
          <span className="pt-0.5">{it}</span>
        </li>
      ))}
    </ol>
  );
}
function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mb-3 flex list-disc flex-col gap-1 pl-5 marker:text-content-muted">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}
function K({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface px-1 py-px font-mono text-2xs text-content-muted">
      {children}
    </kbd>
  );
}
function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-content">{children}</strong>;
}
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-content-muted">{children}</div>
  );
}

const CONTENT: Record<HelpSection, ReactNode> = {
  start: (
    <>
      <H>3단계로 첫 일정 만들기</H>
      <Steps
        items={[
          <>위쪽 <B>작업 추가</B> 버튼으로 작업을 만들고, 이름을 입력합니다. 표에서 오른쪽 클릭 → <B>이 행 아래 추가</B>도 됩니다.</>,
          <>왼쪽 표의 <B>시작</B>·<B>종료</B> 칸에 날짜를 넣거나, 오른쪽 차트의 막대를 끌어 날짜를 정합니다. 날짜는 <K>20260105</K>처럼 숫자만 써도 됩니다.</>,
          <>순서가 있는 작업은 <K>Alt</K>를 누른 채 앞 작업 막대에서 다음 작업 막대로 끌어 연결합니다. 앞 작업이 늦어지면 뒤 작업이 자동으로 밀립니다.</>,
        ]}
      />
      <Note>
        엑셀에 이미 작업 목록이 있다면 <B>엑셀에서 붙여넣기</B> 항목을 보세요. 한 번에 여러 작업을 넣을 수 있습니다.
      </Note>
      <H>화면 구성</H>
      <List
        items={[
          <><B>위쪽 도구 모음</B>: 1줄은 파일·작업 편집, 2줄은 화면 전환과 보기 설정입니다. 버튼 위에 마우스를 올리면 설명이 나옵니다.</>,
          <><B>왼쪽 표</B>: 작업 목록입니다. 엑셀처럼 칸을 골라 바로 입력할 수 있습니다.</>,
          <><B>오른쪽 차트</B>: 작업 기간을 막대로 보여 줍니다. 빈 곳을 끌면 화면이 움직입니다.</>,
          <><B>아래쪽 상태 표시줄</B>: 작업 수, 예상 완료일, 저장 상태를 보여 줍니다.</>,
        ]}
      />
      <P>작업은 1분 안에 자동으로 임시 저장되어, 프로그램이 갑자기 꺼져도 다음 실행 때 복구할 수 있습니다. 그래도 파일 저장(<K>Ctrl+S</K>)은 꼭 해 주세요.</P>
    </>
  ),

  edit: (
    <>
      <H>작업 입력과 수정</H>
      <List
        items={[
          <>칸을 클릭하고 바로 타자를 치면 입력이 시작됩니다. 기존 내용을 고치려면 <K>F2</K> 또는 더블클릭하세요.</>,
          <>방향키로 칸을 옮기고, <K>Shift</K>+방향키 또는 <K>Shift</K>+클릭으로 여러 칸을 고릅니다.</>,
          <>칸을 고른 상태에서 <K>Ctrl+C</K>/<K>Ctrl+V</K>로 엑셀처럼 복사·붙여넣기 할 수 있습니다.</>,
          <>차트의 막대를 더블클릭하면 메모, 담당자, 우선순위 등 자세한 내용을 고칠 수 있는 창이 열립니다.</>,
        ]}
      />
      <H>그룹(상위·하위 작업) 만들기</H>
      <P>
        여러 작업을 한 단계로 묶으려면 묶일 작업들을 고르고 <B>하위로</B>(<K>Tab</K>)를 누르세요. 바로 위 작업이
        그룹이 되고, 그룹의 기간과 진척률은 하위 작업에서 자동으로 계산됩니다. 그룹 밖으로 빼려면 <B>상위로</B>(<K>Shift+Tab</K>).
      </P>
      <P>여러 작업을 고른 뒤 오른쪽 클릭 메뉴의 <B>새 그룹으로 묶기</B>를 써도 됩니다. 그룹 이름 왼쪽의 화살표로 접고 펼칩니다.</P>
      <H>작업 취소와 삭제</H>
      <P>
        작업을 바로 지우지 않고 두 단계로 처리합니다. <B>작업 취소</B>(<K>Del</K>)를 누르면 회색 줄이 그어지고 일정 계산에서 빠집니다.
        취소된 작업을 다시 고르면 버튼이 <B>영구 삭제</B>로 바뀝니다. 잘못 지웠다면 <B>되돌리기</B>(<K>Ctrl+Z</K>)를 누르세요.
      </P>
      <H>순서 바꾸기·옮기기</H>
      <List
        items={[
          <><B>위로</B>/<B>아래로</B>(<K>Alt+↑</K>/<K>Alt+↓</K>)로 같은 그룹 안에서 순서를 바꿉니다.</>,
          <>왼쪽 끝의 손잡이를 끌어 원하는 위치에 놓을 수도 있습니다.</>,
          <>다른 그룹으로 옮기려면 작업을 고르고 <K>Ctrl+X</K>(잘라내기), 옮길 위치의 행을 클릭하고 <K>Ctrl+V</K>를 누르면 그 행 바로 아래로 옮겨집니다.
            어떤 작업 &lsquo;안으로&rsquo; 넣으려면 그 작업을 오른쪽 클릭 → <B>잘라낸 작업을 이 작업 안으로 옮기기</B>. 취소는 <K>Esc</K>.</>,
          <><B>복제</B>(<K>Ctrl+D</K>)는 하위 작업과 그 안의 연결까지 통째로 복사해 바로 아래에 붙입니다.</>,
        ]}
      />
    </>
  ),

  schedule: (
    <>
      <H>막대로 날짜 바꾸기</H>
      <List
        items={[
          <>막대 가운데를 끌면 <B>기간은 그대로 두고 날짜만</B> 옮겨집니다.</>,
          <>막대 왼쪽·오른쪽 끝을 끌면 시작일·종료일이 바뀝니다.</>,
          <><B>그룹 막대</B>를 끌면 그 안의 모든 하위 작업이 함께 옮겨집니다.</>,
          <>옮긴 작업은 그 날짜에 고정되지만, 연결된 앞 작업이 더 늦게 끝나면 그만큼 자동으로 밀립니다.</>,
        ]}
      />
      <H>작업 연결(의존성)</H>
      <P>
        <K>Alt</K>를 누른 채 앞 작업 막대에서 뒤 작업 막대로 끌면 &lsquo;앞 작업이 끝나면 뒤 작업 시작&rsquo; 관계가 만들어집니다.
        연결선을 클릭해 고른 뒤 <K>Delete</K>를 누르면 연결이 지워집니다.
      </P>
      <H>기간은 근무일로 셉니다</H>
      <P>
        주말과 공휴일은 기간에서 빠집니다. 예를 들어 금요일에 시작하는 3일짜리 작업은 다음 주 화요일에 끝납니다.
        모든 날을 세고 싶다면 <B>근무일 설정</B>에서 &lsquo;달력일&rsquo; 방식으로 바꾸세요. 공휴일은 <B>공휴일</B> 버튼에서 관리합니다.
      </P>
      <H>날짜를 완전히 고정하고 싶을 때</H>
      <P>막대를 더블클릭해 상세 창을 열고 <B>수동 고정</B>을 켜면, 연결된 작업과 상관없이 그 날짜에 그대로 있습니다.</P>
      <H>크리티컬 패스</H>
      <P>
        빨간색으로 표시되는 작업은 하루만 늦어져도 프로젝트 전체 완료일이 늦어지는 작업입니다. 일정 관리에서 가장 먼저 챙겨야 할 작업들입니다.
        <B> 크리티컬 패스</B> 버튼으로 표시를 켜고 끕니다.
      </P>
    </>
  ),

  paste: (
    <>
      <H>엑셀 표를 그대로 붙여넣기</H>
      <Steps
        items={[
          <>엑셀에서 붙여넣을 칸들을 골라 <K>Ctrl+C</K>로 복사합니다.</>,
          <>이 프로그램의 표에서 <B>붙여넣기를 시작할 칸</B>(예: 첫 작업의 작업명 칸)을 클릭합니다.</>,
          <><K>Ctrl+V</K>를 누르면 클릭한 칸부터 오른쪽·아래로 채워집니다.</>,
        ]}
      />
      <Note>
        엑셀의 열 순서를 이 표의 열 순서(작업명 → 시작 → 종료 …)에 맞춰 복사하면 편합니다. 날짜는 2026-01-05 또는 20260105 형식 모두 됩니다.
      </Note>
      <H>붙여넣을 행이 더 많을 때</H>
      <P>
        붙여넣기는 클릭한 칸이 속한 <B>그룹 안에서만</B> 이루어집니다. 다른 그룹의 작업을 실수로 덮어쓰지 않도록 하기 위해서입니다.
        복사한 행이 그룹 안의 남은 행보다 많으면 어떻게 할지 묻는 창이 나옵니다.
      </P>
      <List
        items={[
          <><B>나머지는 새 작업으로 추가</B>: 남은 행을 채우고, 넘치는 행은 같은 그룹 맨 아래에 새 작업으로 만듭니다.</>,
          <><B>있는 행에만 붙여넣기</B>: 넘치는 행은 버립니다.</>,
          <><B>붙여넣기 취소</B>: 아무것도 바꾸지 않습니다.</>,
        ]}
      />
      <H>기존 작업을 건드리지 않고 새로 추가만 하기</H>
      <P>
        <K>Ctrl+Shift+V</K>를 누르면 복사한 행들이 선택한 작업 바로 아래에 <B>새 작업으로 끼워 넣어집니다</B>(펼쳐진 그룹의 제목 행이면 그 그룹의 맨 위로).
        오른쪽 클릭 메뉴의 <B>복사한 표를 … 새 작업으로 넣기</B>도 같은 방식입니다. 이때는 엑셀 열이 &lsquo;작업명, 시작, 종료, 기간, 진척, 우선순위&rsquo; 순서여야 합니다.
      </P>
      <P>붙여넣기는 한 번의 <B>되돌리기</B>(<K>Ctrl+Z</K>)로 통째로 취소할 수 있습니다.</P>
    </>
  ),

  view: (
    <>
      <H>화면 4가지</H>
      <List
        items={[
          <><B>간트</B>: 작업 표와 일정 막대를 함께 봅니다. 기본 화면입니다.</>,
          <><B>업무량</B>: 담당자별로 주마다 몇 시간 일이 잡혀 있는지 봅니다. 하루 근무시간을 넘는 날은 빨갛게 표시됩니다.</>,
          <><B>달력</B>: 월 달력에 작업을 보여 줍니다. 작업을 클릭하면 상세 창이 열립니다.</>,
          <><B>보기 그룹 현황</B>: 보기 그룹마다 진척률과 지연된 작업 수를 보여 줍니다.</>,
        ]}
      />
      <H>보고 싶은 작업만 보기</H>
      <List
        items={[
          <><B>작업 검색</B>: 표 위쪽 검색 칸에 이름 일부를 입력하면 그 작업만 보입니다.</>,
          <><B>볼 작업 고르기</B>: &lsquo;모든 작업&rsquo;, &lsquo;선택한 작업만&rsquo;, 또는 특정 보기 그룹만 보이게 합니다.</>,
          <><B>담당자별</B>: 고른 담당자가 맡은 작업만 보여 줍니다.</>,
        ]}
      />
      <Note>
        <B>보기 그룹</B>은 자주 함께 보는 작업에 붙이는 &lsquo;책갈피&rsquo;입니다. 상위·하위 작업 구조(그룹 막대)와는 별개이고 일정에 영향을 주지 않습니다.
        작업을 오른쪽 클릭 → 보기 그룹에서 넣고 뺄 수 있습니다.
      </Note>
      <H>확대·축소와 이동</H>
      <List
        items={[
          <>눈금 단위(시간/일/주/월/분기/연)를 고르거나 <K>Ctrl</K>+마우스 휠로 확대·축소합니다.</>,
          <>차트의 빈 곳을 끌거나 마우스 휠로 화면을 움직입니다.</>,
          <>오른쪽 클릭 → <B>차트에서 시작일로 이동</B>으로 그 작업이 있는 곳으로 바로 갑니다.</>,
          <>표와 차트 사이의 경계선을 끌어 폭을 바꿀 수 있고, 차트 왼쪽 아래 슬라이더로 행 높이와 가로 폭을 조절합니다.</>,
        ]}
      />
      <H>차트에 표시</H>
      <List
        items={[
          <><B>오늘 선</B>: 오늘 날짜에 빨간 점선을 표시합니다.</>,
          <><B>계획 비교</B>: 지금 일정을 &lsquo;기준 계획&rsquo;으로 저장해 두면, 나중에 막대 아래 회색 줄로 원래 계획과 비교해 볼 수 있습니다.</>,
          <><B>날짜 표시선</B>: 마감일, 회의일 같은 날에 이름 붙인 세로선을 긋습니다.</>,
        ]}
      />
    </>
  ),

  file: (
    <>
      <H>저장</H>
      <List
        items={[
          <><B>저장</B>(<K>Ctrl+S</K>): 지금 파일에 덮어씁니다. 처음 저장할 때는 위치와 이름을 묻습니다. 버튼에 ●가 보이면 저장하지 않은 변경이 있다는 뜻입니다.</>,
          <><B>다른 이름으로</B>: 다른 이름이나 위치로 저장하고, 그 뒤로는 새 파일에서 작업합니다.</>,
          <><B>사본 저장</B>(내보내기 메뉴): 다른 사람에게 줄 파일을 따로 만듭니다. 지금 작업 중인 파일은 바뀌지 않습니다.</>,
        ]}
      />
      <P>새로 만들기나 열기를 누를 때 저장하지 않은 변경이 있으면, 먼저 저장할지 묻습니다.</P>
      <H>자동 임시 저장과 복구</H>
      <P>
        변경 후 1분 안에 임시 저장됩니다. 프로그램이 비정상 종료되면 다음 실행 때 위쪽에 &lsquo;복구&rsquo; 안내가 나옵니다.
      </P>
      <H>내보내기</H>
      <List
        items={[
          <><B>엑셀</B>: 작업 표와 간트 그림이 들어간 .xlsx 파일입니다.</>,
          <><B>웹 페이지(HTML)</B>: 이 프로그램이 없는 사람도 브라우저로 열어 확대·이동하며 볼 수 있습니다. 작업이 아주 많을 때 가장 좋습니다.</>,
          <><B>이미지(PNG)</B>, <B>PDF</B>: 보고서에 붙이기 좋습니다. 작업이 아주 많으면 이미지 크기 한도 때문에 일부가 잘릴 수 있고, 그때는 알려 드립니다.</>,
        ]}
      />
    </>
  ),

  keys: <ShortcutsTable />,
};

const SHORTCUTS: ({ section: string } | { key: string; desc: string })[] = [
  { section: '파일' },
  { key: 'Ctrl+S', desc: '저장' },
  { key: 'Ctrl+Shift+S', desc: '다른 이름으로 저장' },
  { key: 'Ctrl+N', desc: '새로 만들기' },
  { key: 'Ctrl+O', desc: '열기' },
  { key: 'F1', desc: '도움말' },
  { section: '되돌리기' },
  { key: 'Ctrl+Z', desc: '되돌리기' },
  { key: 'Ctrl+Y / Ctrl+Shift+Z', desc: '다시 실행' },
  { section: '표 편집' },
  { key: 'Enter', desc: '입력 끝내고 아래 칸으로' },
  { key: 'F2 / 더블클릭', desc: '칸 내용 고치기' },
  { key: 'Esc', desc: '입력 취소' },
  { key: 'Shift+방향키', desc: '여러 칸 고르기' },
  { key: 'Ctrl+C / Ctrl+V', desc: '복사 / 붙여넣기 (클릭한 칸부터)' },
  { key: 'Ctrl+Shift+V', desc: '새 작업으로 끼워 넣기' },
  { key: 'Ctrl+D', desc: '복제' },
  { key: 'Ctrl+X → 행 클릭 → Ctrl+V', desc: '작업 옮기기 (그 행 바로 아래로, Esc로 취소)' },
  { key: 'Delete', desc: '작업 취소 → 한 번 더 누르면 영구 삭제' },
  { key: 'Tab / Shift+Tab', desc: '하위로 / 상위로' },
  { key: 'Alt+↑ / Alt+↓', desc: '위로 / 아래로' },
  { section: '차트' },
  { key: '막대 끌기', desc: '날짜 옮기기 (그룹은 하위 작업까지)' },
  { key: '막대 끝 끌기', desc: '시작일·종료일 바꾸기' },
  { key: 'Alt+끌기', desc: '작업 연결' },
  { key: '연결선 클릭 → Delete', desc: '연결 지우기' },
  { key: '막대 더블클릭', desc: '작업 상세 창' },
  { key: '빈 곳 끌기 / Space+끌기', desc: '화면 이동' },
  { key: 'Ctrl+휠', desc: '마우스 위치 기준 확대·축소' },
  { key: 'Ctrl+= / Ctrl+- / Ctrl+0', desc: '확대 / 축소 / 원래 크기' },
];

export function ShortcutsTable() {
  return (
    <div className="text-xs text-content">
      {SHORTCUTS.map((row, i) =>
        'section' in row ? (
          <div key={i} className="mb-1 mt-3 text-2xs font-semibold uppercase tracking-wider text-content-muted first:mt-0">
            {row.section}
          </div>
        ) : (
          <div key={i} className="flex items-center gap-3 py-0.5">
            <kbd className="min-w-[160px] rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-2xs text-content-muted">
              {row.key}
            </kbd>
            <span>{row.desc}</span>
          </div>
        ),
      )}
    </div>
  );
}
