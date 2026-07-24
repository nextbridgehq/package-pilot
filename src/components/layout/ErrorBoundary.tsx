import React, { Component, ErrorInfo, ReactNode } from "react";
import { MessageBar, MessageBarTitle, MessageBarBody } from "@fluentui/react-components";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "20px" }}>
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>Something went wrong</MessageBarTitle>
              {this.state.error?.message}
            </MessageBarBody>
          </MessageBar>
        </div>
      );
    }

    return this.props.children;
  }
}
