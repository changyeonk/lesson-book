// 레슨 횟수·수납 계산. 화면 코드와 분리해 tests/logic.test.js에서 그대로 시험한다.
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const toDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => toDate(new Date());
  const ymOf = (date) => date.slice(0, 7);

  function daysInMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const count = new Date(y, m, 0).getDate();
    return Array.from({ length: count }, (_, i) => {
      const day = i + 1;
      return { date: `${ym}-${pad(day)}`, day, weekday: new Date(y, m - 1, day).getDay() };
    });
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }

  // 주는 월~일이다. 달의 첫 주와 끝 주는 일곱 날보다 짧을 수 있다.
  function weeksInMonth(ym) {
    const days = daysInMonth(ym);
    const weeks = [];
    let cur = [];
    days.forEach((d, i) => {
      cur.push(d);
      if (d.weekday === 0 || i === days.length - 1) {
        weeks.push({ n: weeks.length + 1, days: cur, dates: cur.map((x) => x.date) });
        cur = [];
      }
    });
    return weeks;
  }

  const lessonsOf = (data, id) =>
    data.lessons.filter((l) => l.studentId === id).sort((a, b) => a.date.localeCompare(b.date));
  const paymentsOf = (data, id) =>
    data.payments.filter((p) => p.studentId === id).sort((a, b) => a.date.localeCompare(b.date));

  // 만원 표기용 숫자. 소수 한 자리까지만 쓴다. 75000 -> "7.5", 600000 -> "60"
  const manText = (won) => String(Math.round((Number(won) || 0) / 1000) / 10);

  // 회차제: 받은 묶음을 앞에서부터 채운다. 각 묶음의 단가는 그 수납 기록에서 나오므로
  // 학생 조건을 나중에 바꿔도 이미 받은 묶음의 번호와 금액은 변하지 않는다.
  // 받은 횟수를 넘긴 레슨은 묶음에서 1로 되돌지 않고 현재 조건의 단가로 계속 쌓인다.
  function sessionStatus(data, student) {
    const fallback = Math.max(1, Number(student.packageCount) || 1);
    const currentUnit = (Number(student.packageFee) || 0) / fallback;
    const lessons = lessonsOf(data, student.id);
    const pays = paymentsOf(data, student.id);
    const buckets = [];
    let filled = 0;
    pays.forEach((p) => {
      const size = Number(p.count) || fallback;
      const amount = Number.isFinite(Number(p.amount)) && p.amount !== undefined && p.amount !== null ? Number(p.amount) : size * currentUnit;
      buckets.push({ start: filled, size, unit: amount / size });
      filled += size;
    });
    const paidPackages = buckets.length;
    const paidLessons = filled;
    const prior = Number(student.priorDone) || 0;
    const done = prior + lessons.length;

    const at = (n) => {
      if (n <= paidLessons) {
        const i = buckets.findIndex((b) => n <= b.start + b.size);
        const b = buckets[i];
        const pos = n - b.start;
        return { cycle: i + 1, pos, size: b.size, paid: true, unit: b.unit, amount: Math.round(pos * b.unit) };
      }
      const pos = n - paidLessons;
      return { cycle: paidPackages + 1, pos, size: fallback, paid: false, unit: currentUnit, amount: Math.round(pos * currentUnit) };
    };

    const numbers = {};
    lessons.forEach((l, i) => { numbers[l.date] = at(prior + i + 1); });

    const current = done > 0 ? at(done) : { cycle: 1, pos: 0, size: buckets[0] ? buckets[0].size : fallback, unit: buckets[0] ? buckets[0].unit : currentUnit, amount: 0 };
    const unpaidCount = Math.max(0, done - paidLessons);
    const unpaidAmount = Math.round(unpaidCount * currentUnit);
    const result = {
      done, paidPackages, paidLessons, cycle: current.cycle, pos: current.pos, size: current.size, unit: current.unit, numbers,
      accrued: unpaidCount > 0 ? unpaidAmount : current.amount, unpaidCount, unpaidAmount, dueAmount: 0,
      settled: unpaidCount === 0 && paidLessons > 0,
    };

    if (student.payTiming === 'post') {
      // 끝나고 받기: 안 받은 회차가 묶음 크기만큼 쌓이면 수납 필요. 그때까지 쌓인 값을 받는다.
      if (unpaidCount >= fallback) {
        const owed = Math.floor(unpaidCount / fallback);
        return { ...result, state: 'due', left: 0, owed, dueAmount: unpaidAmount, label: `${owed > 1 ? owed + '묶음 ' : ''}수납 필요` };
      }
      // 미리 받아 둔 회차가 남아 있으면 그만큼 다음 수납이 늦어진다. 남은 회차가 없으면 packageCount와 같다.
      const left = fallback - unpaidCount + Math.max(0, paidLessons - done);
      return { ...result, state: left <= 1 ? 'soon' : 'ok', left, owed: 0, label: `${left}회 후 수납` };
    }
    // 먼저 받기: 받은 횟수를 다 쓰면 다음 묶음 값을 받는다. 그보다 많이 쌓였으면 쌓인 값을 받는다.
    const left = paidLessons - done;
    if (left <= 0) {
      const owed = Math.max(1, Math.floor(unpaidCount / fallback));
      return { ...result, state: 'due', left: 0, owed, dueAmount: Math.max(Number(student.packageFee) || 0, unpaidAmount), label: '수납 필요' };
    }
    return { ...result, state: left <= 1 ? 'soon' : 'ok', left, owed: 0, label: `${left}회 남음` };
  }

  // 월정액: 그달 안에서 몇 번째 레슨인지 센다.
  function monthlyStatus(data, student, ym, today = todayStr()) {
    const lessons = lessonsOf(data, student.id).filter((l) => ymOf(l.date) === ym);
    const numbers = {};
    lessons.forEach((l, i) => { numbers[l.date] = { pos: i + 1, paid: true }; });
    const payment = paymentsOf(data, student.id).find((p) => p.month === ym) || null;
    const payDay = Number(student.payDay) || 1;
    const dueDate = `${ym}-${pad(Math.min(payDay, daysInMonth(ym).length))}`;
    const joined = student.joinedAt ? ymOf(student.joinedAt) : ym;
    const ended = student.graduatedAt ? ymOf(student.graduatedAt) : null;
    let state = 'upcoming';
    if (payment) state = 'paid';
    else if (ym < joined || (ended && ym > ended)) state = 'none';
    else if (today >= dueDate) state = 'due';
    return { count: lessons.length, numbers, payment, dueDate, state };
  }

  // 한 학생의 한 주 합계. 월정액 번호에는 unit이 없으므로 금액은 0이다.
  function weekSummary(numbers, dates) {
    let count = 0;
    let amount = 0;
    dates.forEach((date) => {
      const n = numbers[date];
      if (!n) return;
      count += 1;
      amount += Number(n.unit) || 0;
    });
    return { count, amount: Math.round(amount) };
  }

  // 한 주 전체의 레슨 수와 그 주에 실제로 받은 금액
  function weekTotals(data, dates) {
    const set = new Set(dates);
    return {
      lessons: data.lessons.filter((l) => set.has(l.date)).length,
      received: data.payments.filter((p) => set.has(p.date)).reduce((a, p) => a + (Number(p.amount) || 0), 0),
    };
  }

  // 한 주 회차제 레슨 값의 합. 월정액은 회당 값이 없어 넣지 않는다.
  function weekSessionValue(data, dates) {
    const sum = data.students.filter((s) => s.billing === 'session').reduce((total, s) => {
      const { numbers } = sessionStatus(data, s);
      return total + dates.reduce((a, date) => a + (numbers[date] ? Number(numbers[date].unit) || 0 : 0), 0);
    }, 0);
    return Math.round(sum);
  }

  // 학생 분류
  const GRADES = [
    { key: 'adult', label: '대학생/성인' },
    { key: 'high', label: '고등학생' },
    { key: 'junior', label: '초/중학생' },
  ];
  function guessGrade(age) {
    const n = Number(age);
    if (age === '' || age === null || age === undefined || !Number.isFinite(n)) return 'junior';
    if (n >= 19) return 'adult';
    if (n >= 16) return 'high';
    return 'junior';
  }
  const gradeOf = (s) => (GRADES.some((g) => g.key === s.grade) ? s.grade : guessGrade(s.age));

  // 표의 열 순서: 분류별로 나누고 각 분류 안에서 회차제 먼저, 월정액 다음.
  function groupByGrade(students) {
    return GRADES.map((g) => {
      const list = students.filter((s) => gradeOf(s) === g.key);
      return { ...g, students: [...list.filter((s) => s.billing === 'session'), ...list.filter((s) => s.billing !== 'session')] };
    }).filter((g) => g.students.length);
  }

  // 표와 합계에 넣을 학생: 재학생 + 그달에 기록이 남은 졸업생
  function visibleStudents(data, ym) {
    return data.students.filter((s) => {
      if (s.active !== false) return true;
      return data.lessons.some((l) => l.studentId === s.id && ymOf(l.date) === ym);
    });
  }

  function paymentsInMonth(data, ym) {
    return data.payments.filter((p) => ymOf(p.date) === ym).sort((a, b) => b.date.localeCompare(a.date));
  }

  function validateBackup(obj) {
    return !!obj && Array.isArray(obj.students) && Array.isArray(obj.lessons) && Array.isArray(obj.payments);
  }

  // version 1 예시 그대로인지 본다. 예시 위에 실제 학생이나 수납을 적었다면 demo 값이 true로 남아 있어도
  // 사용자 기록이므로 예시로 덮어쓰면 안 된다.
  const OLD_DEMO = {
    '김서연': { days: [2], note: '가야금. 산조 입문' },
    '이도윤': { days: [1, 4], note: '입시 준비. 대금' },
    '박하린': { days: [6], note: '해금. 집중 시간 짧음' },
    '최지호': { days: [1, 3, 5], note: '판소리. 콩쿠르 준비' },
  };
  function isUntouchedOldDemo(obj) {
    if (!obj.students.length) return !obj.lessons.length && !obj.payments.length;
    const names = Object.keys(OLD_DEMO);
    if (obj.students.length !== names.length || obj.payments.length !== 6) return false;
    const byId = {};
    for (const s of obj.students) {
      const old = OLD_DEMO[s.name];
      if (!old || s.note !== old.note || String(s.days) !== String(old.days)) return false;
      byId[s.id] = old;
    }
    if (Object.keys(byId).length !== names.length) return false;
    return obj.lessons.every((l) => {
      const old = byId[l.studentId];
      if (!old) return false;
      const [y, m, d] = l.date.split('-').map(Number);
      return old.days.includes(new Date(y, m - 1, d).getDay());
    });
  }

  const migrateStudent = (s) => ({
    ...s,
    grade: gradeOf(s),
    song: s.song ?? '',
    studentPhone: s.studentPhone ?? '',
    parentPhone: s.parentPhone ?? '',
  });

  // 저장값과 백업 파일을 현재 형식으로 바꾼다. 입력값을 고치지 않고 새 객체를 돌려준다.
  // makeDemo를 주면 손대지 않은 version 1 예시는 새 예시로 교체한다(앱을 열 때만 준다. 백업 불러오기는 변환만 한다).
  // 교체하지 않은 version 1 데이터는 사용자 기록으로 보고 demo를 끈다.
  function migrateData(obj, makeDemo) {
    const version = Number(obj.version) || 1;
    if (version < 2 && obj.demo === true && makeDemo && isUntouchedOldDemo(obj)) return makeDemo();
    const out = { ...obj, version: Math.max(version, 2), students: obj.students.map(migrateStudent) };
    if (version < 2) out.demo = false;
    return out;
  }

  // 예시 표시(demoSeed)가 있는 학생과 그 기록만 지운다. 직접 추가한 학생은 남는다.
  function clearDemoSeed(data) {
    const seeded = new Set(data.students.filter((s) => s.demoSeed).map((s) => s.id));
    return {
      ...data,
      demo: false,
      students: data.students.filter((s) => !seeded.has(s.id)),
      lessons: data.lessons.filter((l) => !seeded.has(l.studentId)),
      payments: data.payments.filter((p) => !seeded.has(p.studentId)),
    };
  }

  const api = {
    toDate, todayStr, ymOf, daysInMonth, shiftMonth, weeksInMonth, lessonsOf, paymentsOf, manText,
    sessionStatus, monthlyStatus, weekSummary, weekTotals, weekSessionValue, clearDemoSeed, GRADES, guessGrade, gradeOf, groupByGrade,
    visibleStudents, paymentsInMonth, validateBackup, isUntouchedOldDemo, migrateData,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LessonLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
