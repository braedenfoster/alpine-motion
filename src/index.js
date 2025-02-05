import { animate, spring, inView, scroll, stagger, mix } from "motion";

const functionRegistry = {
  spring: (...args) => spring(...args),
  stagger: (...args) => stagger(...args),
};

export default function (Alpine) {
  Alpine.directive("motion", motion);

  Alpine.magic("sequence", () => async (names, options) => {
    const elements = Object.keys(Alpine.store("motion").elements)
      .filter((name) => names.includes(name))
      .reduce((acc, name) => {
        acc.push(Alpine.store("motion").elements[name]);
        return acc;
      }, []);

    const sequence = elements.map((element) => [
      element.el,
      ...Alpine.raw(element.options),
    ]);

    animate(sequence, options);
  });

  Alpine.magic("motion", () => (name) => {
    /// find the element in the store by name

    if (!Alpine.store("motion")) {
      console.warn("No motion elements found");
      return;
    }

    const animationData = Alpine.store("motion").elements[name];

    if (!animationData) {
      console.warn(`x-motion:${name} not found`);
      return;
    }

    return animate(animationData.el, ...animationData.options);
  });

  Alpine.magic("animate", () => (name, options) => {
    return animate(name, options);
  });

  Alpine.magic("mix", () => (options) => {
    return mix(options);
  });

  Alpine.magic("scroll", () => (callback, options) => {
    return scroll(callback, options);
  });

  Alpine.magic("stagger", () => (callback, options) => {
    return stagger(callback, options);
  });

  Alpine.magic("inView", () => (callback, options) => {
    return inView(callback, options);
  });

  Alpine.magic("spring", () => (callback, options) => {
    return spring(callback, options);
  });

  async function motion(
    el,
    { expression, modifiers, value },
    { evaluateLater, evaluate, effect, cleanup }
  ) {
    const specialModifiersIndex = ["in-view", "scroll"];
    const specialModifiers = modifiers.filter((modifier) =>
      specialModifiersIndex.includes(modifier)
    );

    registerMotion(
      el,
      expression,
      effect,
      specialModifiers,
      evaluateLater,
      evaluate
    );

    cleanup(() => {
      console.log("cleanup");
    });
  }

  function registerMotion(
    el,
    expression,
    effect,
    specialModifiers,
    evaluateLater,
    evaluate
  ) {
    const animationData = parseExpression(expression, evaluateLater);

    // if nameless then run the animation now when in view
    if (animationData.nameless) {
      effect(() => {
        animationData.nameless((data) => {
          const resolvedData = resolveFunctionCalls(data);
          const animationHandled = handleSpecialModifiers(
            el,
            resolvedData,
            effect,
            specialModifiers
          );

          // Defaults to in-view if no special modifiers are used and is nameless
          if (!animationHandled) {
            animate(el, ...resolvedData);
          }
        });
      });
      return;
    }

    // if named then store the animation
    if (animationData.named) {
      allocateAnimations(animationData.named, el, effect, specialModifiers);
    }
  }
}

async function allocateAnimations(animationData, el, effect, specialModifiers) {
  if (!Alpine.store("motion")) {
    Alpine.store("motion", { elements: {} });
  }
  // Running in an effect allows the animation to be run when the data changes
  effect(() => {
    animationData(async (data) => {
      const resolvedData = resolveFunctionCalls(data);
      for (const [key, value] of Object.entries(resolvedData)) {
        handleSpecialModifiers(el, value, effect, specialModifiers);
        // Already exists
        if (Alpine.store("motion").elements[key]) {
          animate(el, ...value);
          return;
        }
        Alpine.store("motion").elements[key] = {
          name: key,
          options: value,
          el,
        };
      }
    });
  });
}

function handleSpecialModifiers(el, options, effect, specialModifiers) {
  if (specialModifiers.length === 0) return false;

  //in-view
  if (specialModifiers.includes("in-view")) {
    inView(el, () => {
      animate(el, ...options);
    });
    return true;
  }

  if (specialModifiers.includes("scroll")) {
    const animation = animate(el, ...options);

    // find the scroll target in options if it exists
    const scrollTarget = options.find((option) => option.scrollTarget);
    const scrollContainer = options.find((option) => option.scrollContainer);
    const scrollAxis = options.find((option) => option.scrollAxis);
    const scrollOffset = options.find((option) => option.scrollOffset);

    const settings = {
      target: scrollTarget ? scrollTarget.scrollTarget : undefined,
      container: scrollContainer ? scrollContainer.scrollContainer : undefined,
      axis: scrollAxis ? scrollAxis.scrollAxis : undefined,
      offset: scrollOffset ? scrollOffset.scrollOffset : undefined,
    };

    scroll(animation, settings);
    return true;
  }
}

/**
 * Parses an expression string and handles special cases for spring animations
 * @param {string} expression - The expression to parse, can be a single object or a spring animation call
 * @param {Function} evaluateLater - Function to evaluate the expression later in Alpine.js context
 * @returns {Object} An object with either a 'nameless' or 'named' property containing the evaluated expression
 *
 * If the expression is a single object (wrapped in curly braces), it returns:
 * { nameless: evaluatedExpression }
 *
 * Otherwise returns:
 * { named: evaluatedExpression }
 *
 * For spring animations, it transforms spring() calls into marker objects that can be
 * processed later by resolveSpringCalls()
 */
function parseExpression(expression, evaluateLater) {
  const isSingleObject = expression.match(/^\{.*\}$/);

  // Create regex pattern for all registered functions
  const functionPattern = new RegExp(
    `(${Object.keys(functionRegistry).join("|")})\\((.*?)\\)`,
    "g"
  );

  if (expression.includes("(")) {
    // Replace function calls with marker objects
    expression = expression.replace(
      functionPattern,
      (_, name, args) =>
        `({ _functionCall: true, name: '${name}', args: [${args}] })`
    );
  }

  if (isSingleObject) {
    return {
      nameless: evaluateLater(`[${expression}]`),
    };
  }

  return {
    named: evaluateLater(expression),
  };
}

function resolveFunctionCalls(data) {
  function resolveValue(value) {
    // Return early for null or undefined
    if (value == null) return value;

    // Return early for primitive values
    if (typeof value !== "object") return value;

    // Handle function calls
    if (value._functionCall && functionRegistry[value.name]) {
      return functionRegistry[value.name](...value.args);
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((v) => resolveValue(v));
    }

    // Handle plain objects
    if (value.constructor === Object) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, resolveValue(v)])
      );
    }

    return value;
  }

  // Handle the top-level input
  if (Array.isArray(data)) {
    return data.map((item) => resolveValue(item));
  }

  if (data && typeof data === "object") {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, resolveValue(value)])
    );
  }

  return data;
}
