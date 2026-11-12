# Government and Regulated-Sector Readiness

Status: draft for discussion, 12 November 2026. Companion to `module-breakdown.md`.

This is an engineering reading of public guidance, written to shape the product. It is not legal advice. Your compliance team and the customer's must confirm what applies. Where a point rests on secondary commentary or on my own knowledge and was not checked against a primary source, the text says so.

## 1. Summary

The first customer is Goodenough College in London, a registered educational charity. Section 2.9 says which parts of this document apply to it. The rest covers the two kinds of UK customer likely to follow, whose requirements overlap heavily:

- a **public body** (department, agency, regulator, council, NHS body);
- a **regulated financial firm** (bank or insurer supervised by the FCA).

Most of what either needs was already in the plan: WCAG 2.2 AA, tenant isolation, an audit trail, no trackers, encryption, limits against abuse, a penetration test. This exploration adds six small product changes, one hosting question and a list of evidence to hand over.

**Product changes, all in the first release**

1. A permanent notice that the user is talking to an AI assistant, with a short statement of what it cannot do.
2. An "other ways to get help" link to a person or another channel. Full hand-off to a human agent stays in a later release.
3. Transcript download for the user.
4. Two retention settings in place of one: how long a user can reopen a conversation and how long the record is kept. Both stay off until your team decides the purge policy.
5. Each stored message records the agent version and configuration version that produced it.
6. The loader stores nothing on the visitor's device. The chat stores only what is needed to keep the session the user opened.

**Hosting.** Hosting our gateway in London does not by itself keep data in the UK, because every user message also goes to Purple Fabric (PF) and to the language model behind it. You have confirmed that PF production runs in London and PF staging runs in the US. UK customers are therefore served only through production, and staging carries test data only. One point is left for the record: that the language model PF production calls also runs in the UK.

## 2. United Kingdom

### 2.1 Accessibility

**What the rules say.** Public sector websites and mobile apps must meet WCAG 2.2 AA and publish an accessibility statement that is reviewed regularly. The body remains legally responsible when the work is outsourced. Third-party content is exempt only where the body did not pay for it, develop it or control it. The Government Digital Service monitors compliance; the Equality and Human Rights Commission enforces it (the Equality Commission in Northern Ireland). Source: GOV.UK guidance, last updated 30 September 2024.

**What it means for us.** A chat assistant that a public body buys and configures is in scope, so the exemption does not help. WCAG 2.2 AA is a release gate for the widget, the renderers and the console. A customer's brand colours must not be able to break contrast. Because mobile apps are covered, the chat must also be accessible inside an app's web view. Private firms are not under these regulations but have duties under the Equality Act 2010, so the same standard is the practical target for them.

**Evidence we hand over.** An accessibility conformance report from an independent auditor; a list of known issues the customer can copy into its own statement; a description of how we test.

### 2.2 Data protection

**What the rules say.** UK GDPR and the Data Protection Act 2018, as amended by the Data (Use and Access) Act 2025. Most of the data protection changes are reported as in force from 5 February 2026, including replacement rules on automated decisions.

**Roles.** The customer is the controller. Intellect is the processor for this platform and for PF. The cloud host and whichever model provider PF uses are sub-processors.

**What it means for us.**

- Processor terms, a sub-processor list, and prompt notice to the customer of any breach.
- Support for access, export and erasure requests. Erasure has to reach PF's copy of the conversation as well as ours, which is why a PF delete call is on the question list.
- Users type personal and sometimes sensitive information into a free-text box and nothing can prevent that. Every transcript is therefore treated as sensitive: encrypted, access-controlled, and absent from logs.
- A public-facing AI assistant is likely to need a data protection impact assessment. That is the customer's task; we supply the facts it needs.
- The rules on automated decisions concern what the customer uses its agent for. The widget itself decides nothing.
- International transfers: see the hosting question in section 1.

**Evidence we hand over.** A data-flow diagram; a description of the processing; the sub-processor list; retention and deletion behaviour; a summary of security measures.

### 2.3 Storage on the user's device

**What the rules say.** Under the Privacy and Electronic Communications Regulations, storing or reading information on a user's device needs consent unless an exemption applies. The Information Commissioner's final guidance on "storage and access technologies" is reported as published on 29 April 2026 and covers web storage as well as cookies. The long-standing exemption is storage that is strictly necessary for a service the user has asked for. The new exemptions from the 2025 Act are narrow and tied to specific purposes.

**What it means for us.** The loader stores nothing. Nothing is stored before the user opens the chat. After that, the chat stores only what keeps that session going. There are no analytics identifiers and no third-party tags. The aim is that the customer needs no consent banner entry for the widget; the customer's data protection officer makes that call.

**Evidence we hand over.** A storage inventory: every item stored, where, why and for how long.

### 2.4 Security assurance

| Expectation | What it is | What it means for us |
|---|---|---|
| NCSC cloud security principles | Fourteen principles covering data in transit, asset protection, separation between customers, governance, secure use and others. Public buyers expect a written response to each. | Write the response as the service is built. The principle on audit information means a customer's administrators can read their own audit entries (M8-T9). |
| Cyber Essentials | Procurement Policy Note 014 tells central government, agencies and NHS bodies when to require Cyber Essentials or Cyber Essentials Plus. G-Cloud 15 is reported to ask suppliers for the certificate. | A company certificate, not a product feature. A question for Intellect: is it held? |
| Secure by Design | Mandatory for central government departments and arm's-length bodies when they build or significantly change a digital service that goes through spend control. Expected in supplier contracts; suppliers map their security plan to its principles. The government's AI Playbook requires AI projects to follow it. | Keep the threat model, security requirements, risk register and test results in a form that maps to those principles (M12-T1). |
| Penetration test | Government buyers commonly ask for a test by a provider in the NCSC CHECK scheme. This is from my own knowledge and was not verified in this pass. | Choose a CHECK provider for M12-T10. |
| ISO 27001 | Commonly requested of suppliers. | Company-level. A question for Intellect. |

### 2.5 Expectations specific to AI in the public sector

- **AI Playbook for the UK Government** (Government Digital Service, 10 February 2025). It replaced the earlier generative AI framework. Its principles include using AI securely, keeping meaningful human control, and being open about its use.
- **Algorithmic Transparency Recording Standard.** Mandatory for central government departments, and for arm's-length bodies that deliver public services or deal directly with the public. Whether a particular assistant must have a published record depends on the policy's criteria, and the customer decides.

**What it means for us.** The AI notice, the route to a person, feedback buttons and conversation records all support these. We also prepare an information pack that pre-fills a transparency record: what the assistant does, who supplies it, the model behind it, the data it uses, the human oversight in place, and known risks with their mitigations.

### 2.6 Service design expectations

These are from my own knowledge of the GOV.UK Service Standard and Service Manual and were not re-checked in this pass.

- A service should still work when a script fails to load. Our loader is an addition to the host page and never a dependency of it, and the "other ways to get help" link gives a route that does not need the chat.
- Services should be usable on slow connections and older devices. The size limits in the plan serve this.
- Bodies with Welsh-language duties need the interface in Welsh. The string catalogue makes that a translation task. Whether answers come back in Welsh depends on the PF agent.

### 2.7 Regulated financial firms

On 19 October 2026 the FCA published "AI in financial services: good practice and areas for improvement". As summarised by a law firm, it creates no new rules: the Consumer Duty, senior-manager accountability and operational resilience already apply, and buying AI from a vendor does not move responsibility away from the firm. The examples below are the ones that touch a customer-facing assistant.

| FCA good practice | What the product provides |
|---|---|
| Make clear the consumer is using an AI tool, explain what it can and cannot do, and say when to seek help elsewhere | AI notice and limits text (M2-T13) |
| Let consumers choose non-AI support and switch channel without repeating themselves | "Other ways to get help" link and transcript download now; hand-off with the transcript attached in a later release |
| Keep records of prompts, outputs, model versions, filters applied and escalation decisions | Stored transcripts with agent and configuration version on each message; a retention setting separate from the user's 5-day window; export (M7-T5) |
| Monitor real outcomes, not only technical measures | Feedback, usage view, and export of sampled conversations for the firm's own review (M13) |
| Contract terms with vendors, notice of significant model changes, fallback and exit plans | Versioned releases with a change log and a pinned loader option; a published message format; full export on exit. Changes to the PF agent stay under the firm's control. |
| Include AI dependencies in resilience planning and test before launch | A dependency map, recovery targets, and load and failure test results shared with the firm (M14) |

A regulated firm may need to keep records for years while showing its users a shorter history. The two retention settings allow that. I did not check the FCA Handbook's own record-keeping and outsourcing rules; the customer's compliance team should.

### 2.8 Buying route

G-Cloud 15 is the main framework through which UK public bodies buy cloud software. Reports say it was awarded in August 2026 and is run by the Government Commercial Agency, which replaced the Crown Commercial Service in April 2026. The sources disagree on exact dates. If Intellect is not a supplier on it, a public body needs another route. This is a commercial question and is noted here only because it can block a sale that the product is otherwise ready for.

### 2.9 First customer: Goodenough College

Goodenough College is a registered charity and a company limited by guarantee. It houses roughly 700 postgraduate students and their families, from about 80 countries, in central London. It is not a public body and is not regulated by the FCA.

| Topic | Applies to the College? | Note |
|---|---|---|
| Data protection (2.2) | Yes | The College is the controller and Intellect the processor. Its residents come from many countries, but the processing happens in the UK under UK law. |
| Storage on the device (2.3) | Yes | Applies to every UK website. |
| Accessibility (2.1) | The public-sector regulations very likely do not bind it. The Equality Act does. | WCAG 2.2 AA remains the target. For the College to confirm. |
| Supplier security evidence (2.4) | Through its own procurement, not government policy | You have confirmed Intellect holds Cyber Essentials and ISO 27001. |
| Public-sector AI rules, transparency record, Secure by Design (2.4, 2.5) | No | |
| FCA expectations (2.7) | No | |
| Government buying framework (2.8) | No | |

What the College changes in practice:

- The six product changes in section 1 still stand. They are cheap, and an AI notice and a link to a person are good practice for any customer.
- Its users are international students, so plain English in the interface and the AI notice matters more than Welsh.
- The evidence it is likely to ask for is short: processor terms, the sub-processor list, where data is stored and for how long, and the security certificates.
- Retention is the College's decision as controller. The purge policy your team is discussing should be agreed with it.

## 3. India, for when the first Indian customer appears

A shorter list, to be expanded at that point. All from secondary sources.

| Area | What applies | What it means for us |
|---|---|---|
| Accessibility | Guidelines for Indian Government Websites 3.0 require WCAG 2.1 AA. The STQC directorate certifies sites against them. | WCAG 2.2 AA covers it. The widget will be part of the host site's audit. |
| Data protection | Digital Personal Data Protection Act 2023. Rules notified in November 2025; the main obligations are reported to take effect in May 2027. | Notice and consent in the user's language, erasure, breach notice, processor terms. |
| Hosting | Government data is expected on cloud services empanelled by the IT ministry, stored in India. | A deployment in an Indian region. Check the current empanelment list. |
| Logging | The April 2022 CERT-In directions require logs to be kept for a rolling 180 days inside India. | A log-retention setting per region. |
| Reach | Many languages, including right-to-left scripts; mobile first; UMANG is mainly an app. | The string catalogue, direction-neutral layout and the web-view route already planned. |

## 4. Changes made to the module plan

| Change | Where |
|---|---|
| AI notice, "other ways to get help" link, transcript download | M2-T13 |
| The loader stores nothing on the device | M1-T7 |
| Two retention settings; agent and configuration version on each message | M7-T5 |
| A tenant's administrators can read their own audit entries | M8-T9 |
| UK evidence pack | M12-T9 |
| London as the first region; dedicated deployments on a named public cloud | M14-T4, D16 |

## 5. Questions for your compliance and commercial teams

Answered on 12 November 2026: the first customer is Goodenough College; PF production runs in London; Intellect holds Cyber Essentials and ISO 27001.

Still open:

1. The model is from the Claude Sonnet family. Does PF production call it through a service hosted in the UK, and which company serves it? That company belongs on the sub-processor list.
2. Is there an existing processor agreement and sub-processor list for PF that this product can extend?
3. What purge policy will apply, and has the College agreed it?
4. For later public-sector customers: is Intellect a supplier on G-Cloud 15, or is there another buying route?

## Sources

- https://www.gov.uk/guidance/accessibility-requirements-for-public-sector-websites-and-apps
- https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/02/statement-on-the-commencement-of-the-data-use-and-access-act-duaa
- https://privacymatters.dlapiper.com/2026/02/uk-commencement-of-the-data-protection-provisions-in-the-data-use-and-access-act/
- https://www.hunton.com/privacy-and-cybersecurity-law-blog/uk-ico-publishes-guidance-on-storage-and-access-technologies
- https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2025/09/uk-ico-s-updated-guidance-for-new-exceptions-to-cookie-consents-.html
- https://www.ncsc.gov.uk/guidance/implementing-cloud-security-principles
- https://assets.publishing.service.gov.uk/media/67af78c8a75f02dffca29bd8/PPN_014_Cyber_essentials_scheme.pdf
- https://www.security.gov.uk/policy-and-guidance/secure-by-design/policy
- https://www.gov.uk/government/collections/algorithmic-transparency-recording-standard-hub
- https://dwfgroup.com/en-au/news-and-insights/insights/2025/3/uk-government-launches-new-ai-playbook
- https://www.tlt.com/insights-and-events/insight/fca-publishes-ai-good-practice-guide---what-regulated-firms-must-do-now
- https://www.stotles.com/resource/blog/g-cloud-15-award-date-moves-to-6-august-2026-what-suppliers-need-to-know
- https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/312894/full-print
- https://en.wikipedia.org/wiki/Goodenough_College
- https://guidelines.india.gov.in/scope-and-objective/
- https://www.azbpartners.com/bank/indias-digital-personal-data-protection-act-phased-rollout-and-key-compliance-milestones/
- https://www.internetsociety.org/resources/doc/2022/internet-impact-brief-india-cert-in-cybersecurity-directions-2022/
