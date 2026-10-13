import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import pg from "pg";

test.beforeEach(async () => {
  if (process.env.VERCEL || process.env.NODE_ENV === "production")
    throw new Error("Browser E2E tests must only use a development database.");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Browser E2E tests require a local database.");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("DELETE FROM rate_limits WHERE key LIKE $1", ["login:%"]);
  await client.end();
});
async function login(page: Page, email: string) {
  await page.goto("/login");
  const audience = email === "teacher@example.test" ? "teacher" : "student";
  await page
    .getByRole("group", { name: "Choose sign-in type" })
    .getByRole("button", { name: new RegExp(audience, "i") })
    .click();
  await page.getByLabel("University email").fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.SEED_PASSWORD!);
  await page.getByRole("button", { name: `Sign in as ${audience}` }).click();
  await expect(page).toHaveURL(/workspace/);
}
test("explains the approved student account after Google access is denied", async ({
  page,
}) => {
  await page.goto("/login?error=AccessDenied");
  await expect(page.locator("p[role='alert']")).toContainText(
    "verified Bangkok University student Google account ending in @bumail.net",
  );
  await expect(page.locator("p[role='alert']")).toContainText(
    "contact your instructor",
  );
});
test("teacher workspace, authoring, audit and responsive layout", async ({
  page,
  browser,
}) => {
  await login(page, "teacher@example.test");
  await expect(
    page.getByRole("heading", { name: /Good to see you/ }),
  ).toBeVisible();
  await expect(page.locator(".exam-row").first()).toBeVisible();
  await page.screenshot({
    path: ".data/dashboard-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Students & courses", exact: true })
    .click();
  const courses = await (
    await page.request.get("/api/platform/courses")
  ).json();
  const course = courses[0];
  await page
    .getByRole("button", {
      name: `Show enrollment QR for ${course.code} section ${course.section || "No section"}`,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: `Course enrollment QR for ${course.code} section ${course.section || "No section"}`,
    }),
  ).toBeVisible();
  const enrollmentUrl = await page.locator(".exam-qr-link").textContent();
  expect(enrollmentUrl).toContain(`/enroll/course/${course.id}?invite=`);
  await page.getByRole("button", { name: "Close course QR" }).click();
  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await login(studentPage, "student1@example.test");
  await studentPage.goto(enrollmentUrl!);
  await expect(
    studentPage.getByRole("heading", { name: "Course joined" }),
  ).toBeVisible();
  await studentContext.close();
  const email = `roster-${Date.now()}@example.test`;
  const createdStudent = await page.request.post("/api/platform/students", {
    headers: { origin: "http://localhost:3000" },
    data: {
      name: "Roster Test Student",
      email,
      studentId: `R${Date.now()}`,
      section: course.section,
      password: "roster-test-password-2026",
    },
  });
  expect(createdStudent.ok()).toBeTruthy();
  await page
    .getByRole("button", {
      name: `View roster for ${course.code} section ${course.section || "unspecified"}`,
    })
    .click();
  await expect(
    page.getByText(`${course.code} · ${course.section}`),
  ).toBeVisible();
  await expect(
    page.getByText(`${course.enrolled_count} enrolled students`),
  ).toBeVisible();
  await page.getByLabel("Enroll an existing student by email").fill(email);
  await page.getByRole("button", { name: "Enroll student" }).click();
  await expect(
    page.getByRole("cell", { name: email, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Examinations", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Examinations", exact: true, level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create examination", exact: true })
    .click();
  const title = "Browser-verified assessment " + Date.now();
  await page.getByLabel("Exam title").fill(title);
  await page.getByLabel("Course / section").selectOption({ index: 1 });
  await page.getByText("Customize monitoring & examination policy").click();
  const microphoneCheck = page
    .locator(".exam-check-option")
    .filter({ hasText: /^Microphone/ })
    .getByRole("checkbox");
  await expect(microphoneCheck).toBeChecked();
  await page.getByLabel("Security preset").selectOption("practice");
  await expect(microphoneCheck).not.toBeChecked();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Attach question").selectOption({ index: 1 });
  await expect(page.getByText("QUESTION 1 ·")).toBeVisible();
  await page.getByRole("button", { name: "Publish examination" }).click();
  await expect(page.locator(".page-heading .status")).toHaveText("published");
  await page.getByRole("button", { name: "Show exam QR" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("img", { name: `QR code for ${title}` }),
  ).toBeVisible();
  await expect(page.locator(".exam-qr-link")).toContainText(/\/exam\//);
  await page.getByRole("button", { name: "Close exam QR" }).click();
  await page.getByRole("link", { name: "Login & audit", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Login & attendance audit" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace");
  await page.screenshot({ path: ".data/dashboard-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});
test("student preflight, autosave, refresh recovery, submission and API authorization", async ({
  page,
}) => {
  await login(page, "teacher@example.test");
  const courses = await (
    await page.request.get("/api/platform/courses")
  ).json();
  const questions = await (
    await page.request.get("/api/platform/questions")
  ).json();
  const title = "Automated practice " + Date.now();
  const responseCreate = await page.request.post("/api/platform/exams", {
    headers: { origin: "http://localhost:3000" },
    data: {
      title,
      courseId: courses[0].id,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
      duration: 60,
      policy: {
        camera: false,
        microphone: false,
        location: false,
        fullscreen: false,
        classroomCode: false,
        allowMobile: true,
        allowCopy: true,
        allowPaste: true,
      },
      classroom: null,
    },
  });
  expect(responseCreate.status()).toBe(200);
  const created = await responseCreate.json();
  for (const q of [...questions].sort(
    (a, b) =>
      ["MCQ", "MULTI_SELECT", "NUMERIC", "CODING", "ESSAY"].indexOf(a.type) -
      ["MCQ", "MULTI_SELECT", "NUMERIC", "CODING", "ESSAY"].indexOf(b.type),
  ))
    await page.request.post(
      "/api/platform/exams/" + created.id + "/questions",
      {
        headers: { origin: "http://localhost:3000" },
        data: { questionId: q.id },
      },
    );
  await page.request.post("/api/platform/exams/" + created.id + "/control", {
    headers: { origin: "http://localhost:3000" },
    data: { action: "publish" },
  });
  await login(page, "student1@example.test");
  const response = await page.request.get("/api/platform/questions");
  expect(response.status()).toBe(403);
  const card = page.locator(".exam-card").filter({
    has: page.getByRole("heading", { name: title }),
  });
  await card.getByRole("link").click();
  await page
    .getByRole("button", { name: "Check camera, microphone & location" })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I confirm my name, student ID and email are correct.",
    })
    .check();
  await page.getByRole("checkbox", { name: /I have read/ }).check();
  await page.getByRole("button", { name: "Begin secure exam" }).click();
  await expect(page.getByText("QUESTION 1 OF 5")).toBeVisible();
  await page.getByRole("radio", { name: "O(log n)", exact: true }).check();
  await expect(
    page.getByText("All answers saved", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: ".data/exam-screen.png", fullPage: true });
  await page.getByRole("button", { name: "Question 4", exact: true }).click();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15000 });
  await page.locator(".monaco-editor textarea").focus();
  await page.keyboard.type("def is_balanced(text):");
  await page.getByRole("button", { name: "Question 1", exact: true }).click();
  page.on("dialog", (d) => d.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Check camera, microphone & location" })
    .click();
  await page
    .getByRole("checkbox", {
      name: "I confirm my name, student ID and email are correct.",
    })
    .check();
  await page.getByRole("checkbox", { name: /I have read/ }).check();
  await page.getByRole("button", { name: "Begin secure exam" }).click();
  await expect(
    page.getByRole("radio", { name: "O(log n)", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Submit exam", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Examination submitted" }),
  ).toBeVisible();
});

test("strict preflight with simulated devices, location checkpoint and fifth-warning submission", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const teacherContext = await browser.newContext();
  const teacher = await teacherContext.newPage();
  await login(teacher, "teacher@example.test");
  const courses = await (
    await teacher.request.get("/api/platform/courses")
  ).json();
  const bank = await (
    await teacher.request.get("/api/platform/questions")
  ).json();
  const created = await (
    await teacher.request.post("/api/platform/exams", {
      headers: { origin: "http://localhost:3000" },
      data: {
        title: "Strict browser verification " + Date.now(),
        courseId: courses[0].id,
        startsAt: new Date(Date.now() - 60000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
        duration: 60,
        policy: {
          camera: true,
          microphone: true,
          location: true,
          fullscreen: true,
          classroomCode: true,
          maxWarnings: 5,
        },
        classroom: {
          name: "Test room",
          building: "Test",
          latitude: 14.039,
          longitude: 100.615,
          radius: 100,
          accuracy: 50,
        },
      },
    })
  ).json();
  await teacher.request.post(`/api/platform/exams/${created.id}/questions`, {
    headers: { origin: "http://localhost:3000" },
    data: { questionId: bank.find((q: any) => q.type === "MCQ").id },
  });
  await teacher.request.post(`/api/platform/exams/${created.id}/control`, {
    headers: { origin: "http://localhost:3000" },
    data: { action: "publish" },
  });
  const studentEmail = "proctor-" + Date.now() + "@example.test",
    studentId = "QA" + Date.now();
  const studentCreation = await teacher.request.post("/api/platform/students", {
    headers: { origin: "http://localhost:3000" },
    data: {
      email: studentEmail,
      name: "Simulated Proctoring Student",
      studentId,
      password: process.env.SEED_PASSWORD,
      courseId: courses[0].id,
    },
  });
  expect(studentCreation.status()).toBe(200);
  await page.clock.install();
  await page.addInitScript(() => {
    const state = window as Window & {
      __simulateExamSound?: boolean;
      __simulateExamMotion?: boolean;
    };
    const audioPrototype = AudioContext.prototype as any;
    const createAnalyser = audioPrototype.createAnalyser;
    audioPrototype.createAnalyser = function (...args: unknown[]) {
      const analyser = createAnalyser.apply(this, args);
      const sample = analyser.getByteTimeDomainData.bind(analyser);
      analyser.getByteTimeDomainData = (values: Uint8Array) => {
        if (state.__simulateExamSound) values.fill(160);
        else sample(values);
      };
      return analyser;
    };
    const canvasPrototype = CanvasRenderingContext2D.prototype as any;
    const getImageData = canvasPrototype.getImageData;
    let frame = 0;
    canvasPrototype.getImageData = function (...args: unknown[]) {
      const image = getImageData.apply(this, args);
      if (state.__simulateExamMotion) image.data.fill(frame++ % 2 ? 0 : 255);
      return image;
    };
  });
  await page
    .context()
    .grantPermissions(["camera", "microphone", "geolocation"]);
  await page
    .context()
    .setGeolocation({ latitude: 14.039, longitude: 100.615, accuracy: 5 });
  await login(page, studentEmail);
  await page.goto("/exam/" + created.id);
  await expect(page.locator(".exam-risk-warning")).toContainText(
    "automatically submitted",
  );
  await expect(page.locator(".exam-risk-warning")).toContainText(
    "5 security warnings",
  );
  await expect(page.locator(".exam-risk-warning")).toContainText(
    "switching away from or hiding the exam tab/window",
  );
  await page
    .getByRole("button", { name: "Check camera, microphone & location" })
    .click();
  await expect(page.getByText(/Location accuracy: ±5 m/)).toBeVisible({
    timeout: 30000,
  });
  const room = await (
    await teacher.request.get(`/api/platform/exams/${created.id}/room-code`)
  ).json();
  await page.getByLabel("Rotating classroom code").fill(room.code);
  await page
    .getByRole("checkbox", {
      name: "I confirm my name, student ID and email are correct.",
    })
    .check();
  await page.getByRole("checkbox", { name: /I have read/ }).check();
  await page.getByRole("button", { name: "Begin secure exam" }).click();
  await expect(page.getByText("QUESTION 1 OF 1")).toBeVisible();
  await page.getByRole("radio", { name: "O(log n)", exact: true }).check();
  await page.evaluate(() => {
    (window as any).__simulateExamSound = true;
  });
  await page.clock.fastForward(4500);
  await expect(page.locator(".warning-banner")).toContainText(
    "Sustained microphone sound was detected",
  );
  await page.evaluate(() => {
    (window as any).__simulateExamSound = false;
    (window as any).__simulateExamMotion = true;
  });
  await page.clock.fastForward(4500);
  await expect(page.locator(".warning-banner")).toContainText(
    "Repeated camera-frame movement detected",
  );
  await page.evaluate(() => {
    (window as any).__simulateExamMotion = false;
  });
  await expect
    .poll(async () => {
      const monitor = await (
        await teacher.request.get(`/api/platform/exams/${created.id}/monitor`)
      ).json();
      const eventTypes = monitor.events.map((event: any) => event.event_type);
      return (
        eventTypes.includes("SPEECH_ACTIVITY") &&
        eventTypes.includes("CAMERA_MOTION")
      );
    })
    .toBeTruthy();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".warning-banner")).toContainText(
    "Exam tab changed",
  );
  await expect(page.getByText("Warnings 1 / 5", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.getByRole("button", { name: "Acknowledge" }).click();
  await expect
    .poll(async () => {
      const monitor = await (
        await teacher.request.get(`/api/platform/exams/${created.id}/monitor`)
      ).json();
      return monitor.events.some(
        (event: any) => event.event_type === "TAB_HIDDEN",
      );
    })
    .toBeTruthy();
  // Hard-warning events are deliberately debounced by ten seconds server-side.
  await new Promise((resolve) => setTimeout(resolve, 10500));
  await page.clock.fastForward(10500);
  // Advance only browser scheduling to prove that the ten-minute checkpoint fires.
  await page.clock.fastForward(600001);
  await page.clock.fastForward(15001);
  await expect
    .poll(
      async () => {
        const r = await (
          await teacher.request.get(`/api/platform/exams/${created.id}/monitor`)
        ).json();
        if (!r.events.some((e: any) => e.event_type === "LOCATION_CHECK_OK"))
          await page.clock.fastForward(15001);
        return r.events.some((e: any) => e.event_type === "LOCATION_CHECK_OK");
      },
      { timeout: 15000 },
    )
    .toBeTruthy();
  for (let count = 2; count <= 5; count++) {
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (count < 5) {
      await page.clock.fastForward(15001);
      await expect(
        page.getByText(`Warnings ${count} / 5`, { exact: true }),
      ).toBeVisible({ timeout: 20000 });
      await new Promise((resolve) => setTimeout(resolve, 10500));
      await page.clock.fastForward(10500);
    }
  }
  await expect(
    page.getByRole("heading", { name: "Examination submitted" }),
  ).toBeVisible();
  const monitor = await (
    await teacher.request.get(`/api/platform/exams/${created.id}/monitor`)
  ).json();
  const attempt = monitor.students.find((s: any) => s.student_id === studentId);
  expect(attempt.status).toBe("AUTO_SUBMITTED_SECURITY");
  expect(attempt.warnings).toBe(5);
  const detail = await (
    await teacher.request.get(`/api/platform/attempts/${attempt.id}`)
  ).json();
  expect(
    detail.events.filter((e: any) => e.event_type === "WARNING_ISSUED"),
  ).toHaveLength(5);
  const grading = await teacher.request.post(
    `/api/platform/attempts/${attempt.id}/grade`,
    {
      headers: { origin: "http://localhost:3000" },
      data: {
        marks: [
          { questionId: detail.questions[0].id, mark: 5, feedback: "Correct." },
        ],
        feedback: "Reviewed simulated device events.",
      },
    },
  );
  expect(grading.status()).toBe(200);
  expect(
    (
      await teacher.request.get(
        `/api/platform/exams/${created.id}/export?format=xlsx`,
      )
    ).status(),
  ).toBe(200);
  await teacherContext.close();
});

test("new student readiness, learning and appeals pages preserve the exam workspace", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "student6@example.test");
  await page
    .getByRole("link", { name: "Practice & readiness", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Practice & readiness", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Connection check passed",
  );
  await page.getByRole("button", { name: "Test camera", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Camera check passed");
  await page
    .getByRole("button", { name: "Test microphone", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Microphone check passed",
  );
  await page.getByLabel("4", { exact: true }).check();
  await page
    .getByLabel("2. Describe your preparation plan")
    .fill("I will review algorithms and test my setup before exam day.");
  await page
    .getByRole("button", { name: "Save & check practice answers" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "read back from the server",
  );
  await page.reload();
  await expect(
    page.getByLabel("2. Describe your preparation plan"),
  ).toHaveValue("I will review algorithms and test my setup before exam day.");
  await page.screenshot({
    path: ".data/readiness-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "My learning", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your learning journey" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Topic progress" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Incident appeals", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your incident appeals" }),
  ).toBeVisible();
  expect(
    (await page.request.get("/api/platform/growth/actions")).status(),
  ).toBe(403);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/practice");
  await expect(
    page.getByRole("button", { name: "Save & check practice answers" }),
  ).toBeEnabled();
  await page.screenshot({ path: ".data/readiness-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("new instructor action center, analytics, appeals and integration controls render", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, "teacher@example.test");
  for (const [link, heading] of [
    ["Action center", "Instructor action center"],
    ["Exam submissions", "Exam submissions"],
    ["Incident appeals", "Incident appeals"],
    ["University integrations", "Google & university login"],
  ]) {
    await page.getByRole("link", { name: link, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    if (link === "Exam submissions") {
      await expect(
        page.getByRole("button", { name: "View submission" }).first(),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "View submission" })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Submitted paper and answers" }),
      ).toBeVisible();
    }
    if (link === "Action center") {
      await expect(
        page.getByRole("heading", { name: "Pending entry approvals" }),
      ).toBeVisible();
      await page.screenshot({
        path: ".data/action-center-desktop.png",
        fullPage: true,
      });
    }
  }
  await expect(
    page.getByRole("heading", { name: "Google & university login" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Verified Bangkok University student accounts ending in @bumail.net/,
    ),
  ).toBeVisible();
  await page.screenshot({
    path: ".data/integrations-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("student appeal submission and instructor decision complete through the UI", async ({
  page,
}) => {
  await login(page, "teacher@example.test");
  const headers = {
    origin: "http://localhost:3000",
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36",
    "sec-ch-ua-mobile": "?0",
  };
  const courses = await (
    await page.request.get("/api/platform/courses")
  ).json();
  const questions = await (
    await page.request.get("/api/platform/questions")
  ).json();
  const suffix = Date.now();
  const email = `appeal-${suffix}@example.test`,
    title = `Appeal workflow ${suffix}`;
  const student = await page.request.post("/api/platform/students", {
    headers,
    data: {
      name: "Appeals Test Student",
      email,
      studentId: "APL" + suffix,
      password: process.env.SEED_PASSWORD,
      courseId: courses[0].id,
      section: "Browser verification",
    },
  });
  expect(student.status()).toBe(200);
  const examResponse = await page.request.post("/api/platform/exams", {
    headers,
    data: {
      title,
      courseId: courses[0].id,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      duration: 30,
      policy: {
        camera: false,
        microphone: false,
        location: false,
        fullscreen: false,
        classroomCode: false,
        allowMobile: true,
      },
      classroom: null,
    },
  });
  expect(examResponse.status()).toBe(200);
  const exam = await examResponse.json();
  expect(
    (
      await page.request.post(`/api/platform/exams/${exam.id}/questions`, {
        headers,
        data: { questionId: questions[0].id },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(`/api/platform/exams/${exam.id}/control`, {
        headers,
        data: { action: "publish" },
      })
    ).status(),
  ).toBe(200);
  await login(page, email);
  const device = await (
    await page.request.post("/api/platform/me/device", { headers, data: {} })
  ).json();
  const attemptResponse = await page.request.post(
    `/api/platform/exams/${exam.id}/start`,
    {
      headers,
      data: {
        deviceSessionId: device.id,
        deviceClass: "laptop",
        accepted: true,
        checks: {
          camera: false,
          microphone: false,
          screen: false,
          fullscreen: false,
        },
        code: "",
      },
    },
  );
  expect(attemptResponse.status()).toBe(200);
  const attempt = await attemptResponse.json();
  const deviceHeaders = { ...headers, "x-exam-device": device.id };
  expect(
    (
      await page.request.post(`/api/platform/attempts/${attempt.id}/sync`, {
        headers: deviceHeaders,
        data: { events: [{ id: crypto.randomUUID(), type: "TAB_HIDDEN" }] },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(`/api/platform/attempts/${attempt.id}/submit`, {
        headers: deviceHeaders,
        data: {},
      })
    ).status(),
  ).toBe(200);
  await page.goto("/workspace/appeals");
  await page
    .getByLabel("Your explanation")
    .fill(
      "The operating system opened a connection dialog during my examination.",
    );
  await page
    .getByRole("button", { name: "Submit appeal", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("submitted");
  await login(page, "teacher@example.test");
  await page.goto("/workspace/appeals");
  const card = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await card.getByLabel("Review outcome").selectOption("UPHELD");
  await card
    .getByLabel("Reason for this decision")
    .fill("The connection event was reviewed and the explanation is accepted.");
  await card.getByRole("button", { name: "Record review" }).click();
  await expect(page.getByRole("status")).toContainText("history updated");
  await login(page, email);
  await page.goto("/workspace/appeals");
  await expect(
    page.getByText(
      "The connection event was reviewed and the explanation is accepted.",
    ),
  ).toBeVisible();
  await page.screenshot({ path: ".data/appeal-history.png", fullPage: true });
  await login(page, "teacher@example.test");
  await page.goto("/workspace/actions");
  const review = page.locator("details").filter({ hasText: title });
  await review.locator("summary").click();
  await review
    .getByLabel("Review note")
    .fill(
      "Reviewed the synthetic browser warning and documented the accepted explanation.",
    );
  await review
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Review recorded");
  await expect(review).toHaveCount(0);
});
