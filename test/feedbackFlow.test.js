const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFeedback } = require('../controllers/feedbackController');

test('classifyFeedback routes complaint, improvement, and inquiry messages to the correct buckets', () => {
  assert.equal(classifyFeedback('The app keeps crashing when I submit my loan request.'), 'complaint');
  assert.equal(classifyFeedback('Please add a history filter for older loans and a better dashboard layout.'), 'improvement');
  assert.equal(classifyFeedback('How do I know when my loan status changes after approval?'), 'inquiry');
  assert.equal(classifyFeedback('I had a good experience and the team was helpful.'), 'experience');
});
