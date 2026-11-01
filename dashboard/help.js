// The text of the help panel. Plain data, so a unit test can read it. The words are the Factory's glossary terms (GLOSSARY.md).
// An item has a `text` and, optionally, a `term` shown in bold in front of it.
export const HELP_SECTIONS = [
  {
    id: 'stages',
    title: 'Stages',
    items: [
      { term: 'Define', text: 'settle what to build, write a Spec and cut it into Tickets.' },
      { term: 'Build', text: 'implement the Tickets test-first.' },
      { term: 'Check', text: 'independent reviews of the code.' },
      { term: 'Finish', text: 'open the pull request.' },
      { term: 'Follow-up', text: 'collect pull request feedback and return to Build when needed.' },
      { term: 'Done', text: 'the pull request is open, merged or closed, or the Run was abandoned.' },
    ],
  },
  {
    id: 'tracks',
    title: 'Tracks',
    items: [
      { term: 'Full track', text: 'the default: an interview, a Spec and several Tickets.' },
      { term: 'Fast track', text: 'for bug fixes and tiny changes: one confirmation, a short Spec and one Ticket. You confirm it first.' },
    ],
  },
  {
    id: 'waiting',
    title: 'Waiting on you',
    items: [
      { text: 'A red card with a "Needs you" banner waits for your answer in the agent session. The header button "Needs you" shows only those Runs, and they come first in their Stage.' },
    ],
  },
  {
    id: 'check',
    title: 'Check verdicts',
    items: [
      { term: 'pass', text: 'the axis found no Blocking finding.' },
      { term: 'fail', text: 'the axis found a Blocking finding, and the Run goes back to Build (a Rework).' },
      { term: 'skipped', text: 'the axis does not apply to this change.' },
      { term: 'Left open', text: 'findings that do not block, listed in the Check summary.' },
    ],
  },
  {
    id: 'actions',
    title: 'Actions',
    items: [
      { term: 'Merge', text: 'squash and merge the open pull request of a Done Run.' },
      { term: 'Sync', text: 'rebase the Run branch onto the default branch of origin.' },
      { term: 'Clean up', text: 'remove the Run worktree and branch once the pull request is merged.' },
      { term: 'Accept Check', text: 'continue to Finish with a Check that is not clean.' },
      { term: 'Grant extra loop', text: 'allow one more Check loop when the limit is reached.' },
    ],
  },
];

// All the words of the panel in one string, for tests.
export const helpText = () => HELP_SECTIONS.map((s) => [s.title, ...s.items.map((i) => (i.term ? i.term + ' ' : '') + i.text)].join('\n')).join('\n');
