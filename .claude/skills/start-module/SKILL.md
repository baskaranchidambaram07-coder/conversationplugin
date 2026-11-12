---
name: start-module
description: Start work on one module of the conversation plugin, for example "/start-module M1", following the project's standard steps. Use when the user asks to start or begin a module.
argument-hint: <module, for example M1>
---

Start module $ARGUMENTS of the conversation plugin.

If no module was named above, ask which one and stop.

## 1. Read

- `CLAUDE.md`.
- In `docs/module-breakdown.md`: the section for this module, every requirement and decision it cites, the module map in section 6, and sections 12 to 14.
- `docs/tech-stack.md`.
- `docs/pf-capability-sheet.md`, if the module talks to Purple Fabric.

## 2. Check the starting point

Before writing anything, confirm each of these and stop to tell the user if one fails:

- Every module this one depends on (section 6) is merged into `develop`.
- This module's branch is up to date with `develop`. Bring it up to date if it is not.
- The working folder is clean and the pipeline is green on the module branch.

## 3. Agree the scope

Tell the user, in a short list:

- the tasks you will build now for the base version (section 14) and the ones you are leaving for later;
- the design of anything another module will depend on.

Wait for the user's go-ahead.

## 4. Build

Work task by task. For each task:

1. Cut a feature branch from the module branch.
2. Build it in ponytail full mode. Before any user-interface work, load the impeccable skill and follow it.
3. Write the tests the module breakdown lists for the task.
4. Run the checks on this machine and in the pipeline.
5. Open a pull request into the module branch and merge it yourself once the pipeline is green.

## 5. Finish

When the module's done condition in the breakdown is met, stop. Report:

- what was built;
- the number of tests in each category, and their results;
- anything you could not verify.

Then ask for the user's word before merging the module into `develop`. Do not start another module.
