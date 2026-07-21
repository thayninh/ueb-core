import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  FormMessage,
  Input,
  PageContainer,
  Panel,
  Select,
  TableShell,
  Textarea,
} from "@/components/ui";

describe("UI primitives", () => {
  afterEach(cleanup);

  it("forwards native form names and values without changing FormData", () => {
    const submit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      return new FormData(event.currentTarget);
    });
    const { container } = render(
      <form onSubmit={submit}>
        <FormField htmlFor="title" label="Tiêu đề">
          <Input defaultValue="Giá trị" id="title" name="title" />
        </FormField>
        <Select defaultValue="KTPT" name="unit">
          <option value="KTPT">KTPT</option>
        </Select>
        <Textarea defaultValue="Ghi chú" name="note" />
        <Button type="submit">Lưu</Button>
      </form>,
    );

    fireEvent.submit(container.querySelector("form")!);
    const data = submit.mock.results[0]?.value as FormData;
    expect(Object.fromEntries(data)).toEqual({
      note: "Ghi chú",
      title: "Giá trị",
      unit: "KTPT",
    });
  });

  it("exposes disabled, loading, focus, alert and presentation states", () => {
    render(
      <>
        <Button loading>Đang xử lý</Button>
        <Input aria-label="Trường kiểm tra" />
        <Alert role="alert" variant="danger">
          Có lỗi
        </Alert>
        <FormMessage>Lỗi trường</FormMessage>
        <Badge>Trạng thái</Badge>
        <Card aria-label="Card kiểm tra" />
        <Panel aria-label="Panel kiểm tra" />
        <PageContainer data-testid="page-container" />
        <TableShell aria-label="Bảng kiểm tra">
          <table>
            <tbody>
              <tr>
                <td>Dữ liệu</td>
              </tr>
            </tbody>
          </table>
        </TableShell>
      </>,
    );

    expect(screen.getByRole("button", { name: "Đang xử lý" })).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
    const input = screen.getByLabelText("Trường kiểm tra");
    input.focus();
    expect(input).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Có lỗi");
    expect(screen.getByText("Lỗi trường")).toBeInTheDocument();
    expect(screen.getByText("Trạng thái")).toBeInTheDocument();
    expect(screen.getByLabelText("Card kiểm tra")).toBeInTheDocument();
    expect(screen.getByLabelText("Panel kiểm tra")).toBeInTheDocument();
    expect(screen.getByTestId("page-container")).toBeInTheDocument();
    expect(screen.getByLabelText("Bảng kiểm tra")).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("region", { name: "Bảng kiểm tra" })).toBeVisible();
  });
});
