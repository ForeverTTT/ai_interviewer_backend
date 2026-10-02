// Fixtures for scripts/testLiveDirectorContext.js.
// JDs are taken from real SAP working-student postings (2026); the résumés
// are fictional and written for this test. Each résumé has one experience
// that matches the JD strongly, one related project and one unrelated job.

export const PERSONAS = {
  agentDev: {
    label: 'AI Agent Developer',
    position: 'Working Student (f/m/d) - AI Developer @ Signavio (SAP, Berlin)',
    jd: `Working Student (f/m/d) - AI Developer @ Signavio — SAP, Berlin (3 office days/week)
You will join the SAP Signavio Foundation & Intelligent Transformation Joule & Process AI team.
What you will do:
- Joule Skills Development & Configuration: support creation and configuration of custom Joule skills for SAP Signavio integration, defining skill parameters, input/output mappings, and action triggers.
- SAP Signavio Environment Setup & Connectivity: support technical configuration including API connectivity, authentication mechanisms, data access permissions, and communication channels between Joule and Signavio services.
- Integration Testing & Quality Assurance: conduct end-to-end testing of Joule skills, validate data flows, verify user interaction scenarios, and document integration issues.
- Skills Handover Documentation: create documentation for Joule skills deployment, including technical specifications, configuration guides, and troubleshooting procedures.
What you bring:
- Currently enrolled at a university or university of applied sciences, preferably in Artificial Intelligence, Software Development, Business Informatics or a related field.
- Very good knowledge of software development; hands-on experience is a plus.
- Python coding skills or willingness to learn quickly.
- Proficient English; collaborative and proactive problem-solving approach.`,
    jdSummary: [
      'Build and configure AI agent skills (Joule) with parameters, input/output mappings and action triggers',
      'API connectivity and authentication between the agent and backend services',
      'End-to-end testing and quality assurance of agent skills',
      'Python and solid software development',
      'Technical documentation of agent skills',
    ],
    resume: `Lena Wagner — M.Sc. Informatics, Technical University of Munich (expected 2027)

EXPERIENCE
Working Student, AI Engineering — Siemens AG, Munich (Apr 2025 – present)
- Built a customer-support assistant agent in Python (LangChain, FastAPI, Azure OpenAI).
- Designed function calling that maps support requests to 12 internal REST APIs (ticket lookup, warranty check, spare-part order).
- Built a RAG pipeline over 4,000 service documents; cut average first-response time by 30%.
- Wrote an evaluation suite of 300 test conversations to check tool-call correctness before each release.

Working Student, Backend Development — Shopware partner agency, Munich (Oct 2023 – Mar 2025)
- "Shop Backend" project: payment webhook handling in Node.js and PostgreSQL; made webhook processing idempotent with unique constraints and transactions.

Part-time Barista — Café Glockenbach, Munich (2021 – 2023)
- Served customers during peak hours; trained two new colleagues.

SKILLS
Python, TypeScript, Node.js, FastAPI, LangChain, PostgreSQL, Docker, Azure, REST APIs
Languages: German (native), English (C1), Chinese (B1)`,
    anchors: [
      { id: 'siemens', summary: 'Siemens working student (2025–present): Python/LangChain customer-support agent; function calling to 12 internal REST APIs; RAG over 4,000 docs; 300-conversation evaluation suite; −30% first-response time.' },
      { id: 'shop', summary: 'Shop Backend project (2023–2025): idempotent payment webhooks in Node.js/PostgreSQL.' },
      { id: 'barista', summary: 'Part-time barista (2021–2023), unrelated to the role — do not ask about it.' },
    ],
    intents: {
      q1: { anchor: 'siemens', text: 'Ask how they designed the function calling in the Siemens support agent — how user requests were mapped to the internal APIs — and what their own contribution was.' },
      q2: { anchor: 'siemens', text: 'Follow-up on the same Siemens agent: ask how they tested and evaluated whether the agent called the APIs correctly before a release.' },
    },
    lines: {
      English: {
        clarify_project: 'Sorry, which project do you mean exactly — the one at Siemens or the shop backend?',
        partial: 'So, first we described every API as a tool with a JSON schema, and then',
        complete: 'the model picked the tool and we validated the arguments against the schema before calling the API. I designed the tool schemas and the validation layer myself.',
        answer2: 'We had an evaluation suite of 300 recorded conversations with the expected tool calls, and every release had to pass at least 95 percent before deployment. I built that suite.',
        aside: 'By the way, in my barista job I also learned to stay calm when it gets really busy.',
      },
      Deutsch: {
        clarify_project: 'Entschuldigung, welches Projekt meinen Sie genau — das bei Siemens oder das Shop-Backend?',
        partial: 'Also, zuerst haben wir jede API als Tool mit einem JSON-Schema beschrieben, und dann',
        complete: 'hat das Modell das Tool gewählt, und wir haben die Argumente vor dem API-Aufruf gegen das Schema validiert. Die Tool-Schemas und die Validierung habe ich selbst entworfen.',
        answer2: 'Wir hatten eine Testsuite mit 300 aufgezeichneten Gesprächen und den erwarteten Tool-Aufrufen; jedes Release musste mindestens 95 Prozent bestehen. Die Suite habe ich aufgebaut.',
        aside: 'Übrigens habe ich als Barista auch gelernt, ruhig zu bleiben, wenn viel los ist.',
      },
      Chinese: {
        clarify_project: '不好意思，您指的是哪个项目？是西门子那个，还是商城后端那个？',
        partial: '嗯，首先我们把每个 API 都描述成一个带 JSON Schema 的工具，然后',
        complete: '由模型选择调用哪个工具，我们在真正调用 API 之前先按 Schema 校验参数。工具的 Schema 和校验层是我自己设计的。',
        answer2: '我们有一个评测集，包含 300 段录好的对话和预期的工具调用，每次发布前通过率必须达到 95% 以上。这个评测集是我搭的。',
        aside: '顺便说一句，我做咖啡师的时候也学会了在很忙的时候保持冷静。',
      },
    },
  },
  aiPm: {
    label: 'AI Product Manager',
    position: 'Working Student (f/m/d) - AI Product Management (SAP, Berlin)',
    jd: `Working Student (f/m/d) - AI Product Management — SAP, Berlin
What you will do:
- Support the product management team in tasks like project management, roadmap coordination, strategy development.
- Create presentations, communications and documents for different audiences including executive level.
- Assist in gathering and analyzing data to support strategic decision-making and product prioritization.
- Contribute to the planning and execution of product strategies and initiatives.
- Engage with cross-functional teams to ensure alignment with business objectives.
- Help maintain and manage product roadmaps, ensuring timely delivery.
- Facilitate effective communication and collaboration across teams.
- Participate in stakeholder meetings, preparing reports and presentations.
What you bring:
- Enrolment in a Master's degree program in Computer Science, IT, Artificial Intelligence, Business Informatics, Business Management, Project Management or Product Management.
- Excellent skills to create executive-level presentations, documents and communication.
- Able to consolidate information and feedback from different sources into a precise overview.
- Able to leverage AI to optimize your work, e.g. build Claude skills.
- Strong problem-solving, analytical mindset, organizational and project management skills.
- Proficiency in English, with strong communication skills.`,
    jdSummary: [
      'Roadmap coordination, prioritization and product strategy for AI products',
      'Data analysis to support decisions and prioritization',
      'Stakeholder alignment across cross-functional teams',
      'Executive-level presentations and documents',
      'Using AI tools (e.g. building Claude skills) to optimize work',
    ],
    resume: `Jonas Becker — M.Sc. Management & Technology, Technical University of Munich (expected 2027)

EXPERIENCE
Product Management Intern — Zalando SE, Berlin (Mar 2025 – Sep 2025)
- Co-owned the rollout of an AI-based size-recommendation feature for 3 markets.
- Prioritized the roadmap with RICE scoring across data science, app and customer-care teams.
- Ran an A/B test with 400,000 users: returns −4% in the test group, but conversion flat in one market.
- Prepared monthly steering-committee decks for the VP Product.

Working Student, Product Operations — Celonis, Munich (Oct 2025 – present)
- Built internal Claude skills that summarize customer interview notes into structured insights; cut synthesis time from 2 days to 3 hours.

Organizer — TUM Student Film Festival (2022 – 2024)
- Organized screenings and sponsor outreach for an annual student film festival.

SKILLS
Product discovery, roadmapping, A/B testing, SQL, Amplitude, Figma, Claude/ChatGPT
Languages: German (native), English (C1), Chinese (A2)`,
    anchors: [
      { id: 'zalando', summary: 'Zalando PM intern (2025): AI size-recommendation rollout in 3 markets; RICE prioritization; A/B test with 400k users (returns −4%, conversion flat in one market); steering-committee decks.' },
      { id: 'celonis', summary: 'Celonis working student (2025–present): built Claude skills that summarize customer interviews (2 days → 3 hours).' },
      { id: 'festival', summary: 'Student film festival organizer (2022–2024), unrelated to the role — do not ask about it.' },
    ],
    intents: {
      q1: { anchor: 'zalando', text: 'Ask how they prioritized the roadmap for the AI size-recommendation feature at Zalando, which stakeholders they had to align, and what their own contribution was.' },
      q2: { anchor: 'zalando', text: 'Follow-up on the same Zalando feature: ask how they measured success and what they did when the results were mixed across markets.' },
    },
    lines: {
      English: {
        clarify_project: 'Sorry, which project do you mean — the size recommendation at Zalando or the Claude skills at Celonis?',
        partial: 'So, first we collected all the requests from the data science and app teams, and then',
        complete: 'we scored them with RICE and aligned the top three with the customer-care lead, because returns were their biggest cost. I ran the scoring sessions and wrote the roadmap proposal.',
        answer2: 'Our main metric was the return rate, with conversion as a guardrail. When conversion stayed flat in one market, I analyzed the funnel with the data scientist and we paused the rollout there until the size data was cleaned.',
        aside: 'By the way, organizing the student film festival also taught me a lot about sponsors.',
      },
      Deutsch: {
        clarify_project: 'Entschuldigung, welches Projekt meinen Sie — die Größenempfehlung bei Zalando oder die Claude-Skills bei Celonis?',
        partial: 'Also, zuerst haben wir alle Anforderungen von Data Science und dem App-Team gesammelt, und dann',
        complete: 'haben wir sie mit RICE bewertet und die Top drei mit der Leitung des Kundenservice abgestimmt, weil Retouren dort die größten Kosten waren. Die Bewertungsrunden und den Roadmap-Vorschlag habe ich verantwortet.',
        answer2: 'Unsere Hauptkennzahl war die Retourenquote, die Conversion war die Leitplanke. Als die Conversion in einem Markt stagnierte, habe ich mit dem Data Scientist den Funnel analysiert, und wir haben den Rollout dort pausiert, bis die Größendaten bereinigt waren.',
        aside: 'Übrigens habe ich durch das Studentenfilmfestival auch viel über Sponsoren gelernt.',
      },
      Chinese: {
        clarify_project: '不好意思，您指的是哪个项目？是 Zalando 的尺码推荐，还是 Celonis 的 Claude 技能？',
        partial: '嗯，首先我们收集了数据科学团队和 App 团队的所有需求，然后',
        complete: '用 RICE 打分，再和客服负责人对齐了前三项，因为退货是他们最大的成本。打分会和路线图方案是我负责的。',
        answer2: '我们的主要指标是退货率，转化率作为护栏指标。有一个市场的转化率没有提升，我和数据科学家一起分析了漏斗，决定先暂停那个市场的上线，等尺码数据清洗完再继续。',
        aside: '顺便说一句，组织学生电影节也让我学到了很多和赞助商打交道的经验。',
      },
    },
  },
}

// Tone-only style prompts for orchestrated mode: follow-up depth is decided
// by the application, so these keep voice and manner but drop every
// instruction to probe on the interviewer's own initiative.
export const ORCHESTRATED_STYLE_PROMPTS = {
  balanced: `Interviewer style: Professional and balanced.
- Objective, calm, attentive and naturally conversational; respectful, neutral tone.
- Acknowledge briefly and neutrally ("I see", "Understood"); no praise and no filler.`,
  supportive: `Interviewer style: Supportive and encouraging.
- Patient, warm and reassuring; speak slightly slower than normal (about 0.9x) with relaxed phrasing.
- You may briefly recognise one concrete strength of an answer, and briefly encourage the candidate if they hesitate ("Take your time").
- Never supply the answer and never over-praise.`,
  demanding: `Interviewer style: Demanding and high-pressure.
- Concise, firm and direct; keep pleasantries to a minimum.
- Acknowledge with at most one or two words. Do not encourage.
- Ask the application's questions in a firm, precise way.`,
  analytical: `Interviewer style: Analytical and precise.
- Precise, curious and evidence-minded in tone.
- You may restate the candidate's key point in one sentence to show you understood.
- Ask the application's questions precisely.`,
}
