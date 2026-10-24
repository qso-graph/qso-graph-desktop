// SPDX-License-Identifier: GPL-3.0-only
// QGD-FRM-0006: every component in the shell and in `ui` has a story.
//
// Pure, so the rule can be tested without a component tree. With no components
// yet the check passes trivially, which is correct and also exactly the kind of
// pass that means nothing — so its test plants components and requires it to
// notice the ones without stories.

// A story file sits beside its component: Rail.svelte and Rail.stories.ts,
// .stories.js or .stories.svelte.
const STORY = /\.stories\.(?:js|ts|svelte)$/;

export const isStory = path => STORY.test(path);
export const isComponent = path => path.endsWith('.svelte') && !STORY.test(path);

const base = path => path.replace(/\.svelte$/, '');

export function missingStories(files) {
  const components = files.filter(isComponent);
  const stories = new Set(files.filter(isStory).map(path => path.replace(STORY, '')));
  return components.filter(component => !stories.has(base(component)));
}

export function orphanStories(files) {
  const components = new Set(files.filter(isComponent).map(base));
  return files.filter(isStory).filter(story => !components.has(story.replace(STORY, '')));
}
