type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

class AuthLogger {
  private logToConsole(level: LogLevel, message: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      message,
      data: args.length > 0 ? args[0] : undefined
    };

    const logMethod = level === 'error' ? console.error : console.log;
    const prefix = `${timestamp} [AUTH-${level.toUpperCase()}]`;

    if (args.length > 0) {
      logMethod(prefix, message, ...args);
    } else {
      logMethod(prefix, message);
    }

    // In production, you might want to send logs to a logging service
    if (process.env.NODE_ENV === 'production') {
      // TODO: Implement production logging service integration
      // this.sendToLoggingService(logEntry);
    }
  }

  debug(message: string, ...args: any[]) {
    this.logToConsole('debug', message, ...args);
  }

  info(message: string, ...args: any[]) {
    this.logToConsole('info', message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.logToConsole('warn', message, ...args);
  }

  error(message: string, ...args: any[]) {
    this.logToConsole('error', message, ...args);
  }

  // private async sendToLoggingService(logEntry: LogEntry) {
  //   // Implementation for sending logs to external service
  // }
}

export const authLogger = new AuthLogger();
