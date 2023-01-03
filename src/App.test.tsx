import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

test('renders learn react link', async () => {
  render(<App />);
  expect(screen.getByTestId('jsonEditor')).toBeInTheDocument();
  const input = screen.getByTestId('jsonEditor');
  expect(input).toHaveAttribute("data-slate-editor", "true")
  input.focus()
  //fireEvent.change(input, { target: { value: 'matti' } });
  await userEvent.keyboard('{{')
  await screen.findByText("{")
  expect(screen.getByText("{")).toBeInTheDocument();
});
