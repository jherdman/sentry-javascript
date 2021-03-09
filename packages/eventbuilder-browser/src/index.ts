// TODO: All these functions are confusing af. They _have_ to be unified and become more descriptive in one way or another.

import { CaptureContext, Event, OptionsV7, Severity } from '@sentry/types';
import {
  addExceptionMechanism,
  addExceptionTypeValue,
  isDOMError,
  isDOMException,
  isError,
  isErrorEvent,
  isEvent,
  isPlainObject,
  SyncPromise,
} from '@sentry/utils';

import { eventFromPlainObject, eventFromStacktrace, prepareFramesForEvent } from './parsers';
import { computeStackTrace } from './tracekit';

// TODO: Export only necessary thing. Or nothing at all directly from parsers/tracekit.
export * from './tracekit';
export * from './parsers';

/**
 * Builds and Event from a Exception
 * @hidden
 */
export function eventFromException(
  options: OptionsV7,
  exception: unknown,
  captureContext: CaptureContext,
): PromiseLike<Event> {
  const syntheticException = captureContext.hint?.syntheticException;
  const event = eventFromUnknownInput(exception, syntheticException, {
    attachStacktrace: options.attachStacktrace,
  });
  addExceptionMechanism(event, {
    handled: true,
    type: 'generic',
  });
  if (captureContext.hint?.event_id) {
    event.event_id = captureContext.hint?.event_id;
  }
  event.level = Severity.Error;
  event.platform = 'javascript';
  return SyncPromise.resolve(event);
}

/**
 * Builds and Event from a Message
 * @hidden
 */
export function eventFromMessage(
  options: OptionsV7,
  message: string,
  captureContext: CaptureContext,
): PromiseLike<Event> {
  const syntheticException = captureContext.hint?.syntheticException;
  const event = eventFromString(message, syntheticException, {
    attachStacktrace: options.attachStacktrace,
  });
  if (captureContext.hint?.event_id) {
    event.event_id = captureContext.hint?.event_id;
  }
  event.level = captureContext.scope?.level ?? Severity.Info;
  event.platform = 'javascript';
  return SyncPromise.resolve(event);
}

/**
 * @hidden
 */
export function eventFromUnknownInput(
  exception: unknown,
  syntheticException?: Error,
  options: {
    rejection?: boolean;
    attachStacktrace?: boolean;
  } = {},
): Event {
  let event: Event;

  if (isErrorEvent(exception as ErrorEvent) && (exception as ErrorEvent).error) {
    // If it is an ErrorEvent with `error` property, extract it to get actual Error
    const errorEvent = exception as ErrorEvent;
    // eslint-disable-next-line no-param-reassign
    exception = errorEvent.error;
    event = eventFromStacktrace(computeStackTrace(exception as Error));
    return event;
  }
  if (isDOMError(exception as DOMError) || isDOMException(exception as DOMException)) {
    // If it is a DOMError or DOMException (which are legacy APIs, but still supported in some browsers)
    // then we just extract the name, code, and message, as they don't provide anything else
    // https://developer.mozilla.org/en-US/docs/Web/API/DOMError
    // https://developer.mozilla.org/en-US/docs/Web/API/DOMException
    const domException = exception as DOMException;
    const name = domException.name || (isDOMError(domException) ? 'DOMError' : 'DOMException');
    const message = domException.message ? `${name}: ${domException.message}` : name;

    event = eventFromString(message, syntheticException, options);
    addExceptionTypeValue(event, message);
    if ('code' in domException) {
      event.tags = { ...event.tags, 'DOMException.code': `${domException.code}` };
    }

    return event;
  }
  if (isError(exception as Error)) {
    // we have a real Error object, do nothing
    event = eventFromStacktrace(computeStackTrace(exception as Error));
    return event;
  }
  if (isPlainObject(exception) || isEvent(exception)) {
    // If it is plain Object or Event, serialize it manually and extract options
    // This will allow us to group events based on top-level keys
    // which is much better than creating new group when any key/value change
    const objectException = exception as Record<string, unknown>;
    event = eventFromPlainObject(objectException, syntheticException, options.rejection);
    addExceptionMechanism(event, {
      synthetic: true,
    });
    return event;
  }

  // If none of previous checks were valid, then it means that it's not:
  // - an instance of DOMError
  // - an instance of DOMException
  // - an instance of Event
  // - an instance of Error
  // - a valid ErrorEvent (one with an error property)
  // - a plain Object
  //
  // So bail out and capture it as a simple message:
  event = eventFromString(exception as string, syntheticException, options);
  addExceptionTypeValue(event, `${exception}`, undefined);
  addExceptionMechanism(event, {
    synthetic: true,
  });

  return event;
}

/**
 * @hidden
 */
export function eventFromString(
  input: string,
  syntheticException?: Error,
  options: {
    attachStacktrace?: boolean;
  } = {},
): Event {
  const event: Event = {
    message: input,
  };

  if (options.attachStacktrace && syntheticException) {
    const stacktrace = computeStackTrace(syntheticException);
    const frames = prepareFramesForEvent(stacktrace.stack);
    event.stacktrace = {
      frames,
    };
  }

  return event;
}