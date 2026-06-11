// ==UserScript==
// @name         VM Junior Training Simulator
// @namespace    https://vm-manager.org/
// @version      1.1.0
// @description  Pure logic for junior academy training projection in VM Manager.
// @grant        none
// @run-at       document-start
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-sim.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-sim.js
// ==/UserScript==

(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.VMJuniorTrainingSim = api;
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var CONFIG = {
    dailyGain: 4,
    poolCap: 40,
    maxLevel: 30.5,
    seasonDays: 60,
    tierBelow5: 4,
    levelEpsilon: 0.001,
    optimalJuniorCount: 7,
    maxJuniorCount: 14,
    juniorOverloadPenalty: 1 / 14,
  };

  var STRATEGY_META = {
    priority: {
      id: 'priority',
      label: 'Priorytet',
      description: 'Kazdy trening idzie na pierwsza umiejetnosc z listy, ktora nie osiagnela celu.',
    },
    roundRobin: {
      id: 'roundRobin',
      label: 'Rotacja',
      description: 'Treningi na przemian miedzy umiejetnosciami (rownomierny rozwoj).',
    },
    cheapest: {
      id: 'cheapest',
      label: 'Najtanszy awans',
      description: 'Kazdy trening na umiejetnosc z najnizszym kosztem nastepnego awansu.',
    },
    weakest: {
      id: 'weakest',
      label: 'Najsłabsza',
      description: 'Kazdy trening na umiejetnosc z najnizszym aktualnym poziomem.',
    },
  };

  function tierSessionsForIntegerLevel(integerLevel, age) {
    var ageBonus = Math.max(0, age - 16);
    var base = Math.floor(integerLevel);

    if (base < 5) {
      return CONFIG.tierBelow5 + ageBonus;
    }
    if (base < 15) {
      return 5 + ageBonus;
    }
    if (base < 25) {
      return 6 + ageBonus;
    }
    return 7 + ageBonus;
  }

  function fullSessionsForFinalBand(age) {
    return 2 + Math.max(0, age - 16);
  }

  function sessionsToNextMilestone(level, age) {
    var current = Number(level);
    var remainingToMax;
    var remainingFraction;

    if (current >= CONFIG.maxLevel - CONFIG.levelEpsilon) {
      return 0;
    }

    if (current >= 30 - CONFIG.levelEpsilon) {
      remainingToMax = CONFIG.maxLevel - current;
      return Math.max(1, Math.ceil(fullSessionsForFinalBand(age) * remainingToMax / 0.5));
    }

    remainingFraction = 1 - (current - Math.floor(current));
    return Math.max(1, Math.ceil(tierSessionsForIntegerLevel(current, age) * remainingFraction));
  }

  function sessionsToLevelUp(level, age) {
    return sessionsToNextMilestone(level, age);
  }

  function isBelowTarget(level, targetLevel) {
    return level + CONFIG.levelEpsilon < targetLevel;
  }

  function normalizeTargetLevel(targetLevel) {
    var target = targetLevel == null ? CONFIG.maxLevel : Number(targetLevel);
    if (Number.isNaN(target)) {
      return CONFIG.maxLevel;
    }
    return Math.min(CONFIG.maxLevel, Math.max(0, target));
  }

  function getCareerSeasons(age, daysLeftInSeason, seasonDays) {
    var seasons = [];
    var currentAge = Number(age);
    var daysLeft = Number(daysLeftInSeason);
    var seasonLength = Number(seasonDays) || CONFIG.seasonDays;

    if (!Number.isFinite(currentAge) || currentAge > 18) {
      return seasons;
    }

    if (daysLeft > 0) {
      seasons.push({ age: currentAge, days: daysLeft });
    }

    for (var nextAge = currentAge + 1; nextAge <= 18; nextAge += 1) {
      seasons.push({ age: nextAge, days: seasonLength });
    }

    return seasons;
  }

  function getCareerDays(age, daysLeftInSeason, seasonDays) {
    return getCareerSeasons(age, daysLeftInSeason, seasonDays).reduce(function (sum, season) {
      return sum + season.days;
    }, 0);
  }

  function totalTrainingBudget(startPool, days) {
    var pool = Number(startPool);
    var totalDays = Number(days);

    if (!Number.isFinite(totalDays) || totalDays <= 0) {
      return 0;
    }

    if (!Number.isFinite(pool) || pool < 0) {
      pool = 0;
    }

    pool = Math.min(CONFIG.poolCap, pool);
    var firstDay = Math.min(CONFIG.poolCap, pool + CONFIG.dailyGain);
    return firstDay + CONFIG.dailyGain * (totalDays - 1);
  }

  function normalizeJuniorCount(count) {
    var parsed = Number(count);

    if (!Number.isFinite(parsed)) {
      return CONFIG.optimalJuniorCount;
    }

    return Math.max(0, Math.min(CONFIG.maxJuniorCount, Math.round(parsed)));
  }

  function getJuniorTrainingEfficiency(count) {
    var juniorCount = normalizeJuniorCount(count);

    if (juniorCount <= CONFIG.optimalJuniorCount) {
      return 1;
    }

    return Math.max(0, 1 - ((juniorCount - CONFIG.optimalJuniorCount) * CONFIG.juniorOverloadPenalty));
  }

  function trainingsRequiredForSkill(fromLevel, toLevel, age) {
    var total = 0;
    var current = Number(fromLevel);
    var target = normalizeTargetLevel(toLevel);
    var playerAge = Number(age);

    if (Number.isNaN(current) || Number.isNaN(playerAge)) {
      return 0;
    }

    while (isBelowTarget(current, target)) {
      total += sessionsToNextMilestone(current, playerAge);
      if (current >= 30 - CONFIG.levelEpsilon) {
        current = CONFIG.maxLevel;
      } else {
        current = Math.floor(current) + 1;
      }
    }

    return total;
  }

  function cloneSkills(skills, defaultTargetLevel) {
    return skills.map(function (skill) {
      return {
        code: skill.code,
        level: Number(skill.level),
        progress: 0,
        levelUps: 0,
        trainingsUsed: 0,
        targetLevel: normalizeTargetLevel(skill.targetLevel != null ? skill.targetLevel : defaultTargetLevel),
      };
    });
  }

  function getActiveSkillIndexes(skills) {
    var indexes = [];

    skills.forEach(function (skill, index) {
      if (isBelowTarget(skill.level, skill.targetLevel)) {
        indexes.push(index);
      }
    });

    return indexes;
  }

  function applyTraining(skill, age, efficiency) {
    var needed = sessionsToNextMilestone(skill.level, age);
    var leveledUp = false;

    skill.progress += efficiency;

    while (needed > 0 && skill.progress + CONFIG.levelEpsilon >= needed) {
      skill.progress -= needed;
      leveledUp = true;

      if (skill.level >= 30 - CONFIG.levelEpsilon) {
        skill.level = CONFIG.maxLevel;
      } else {
        skill.level = Math.floor(skill.level) + 1;
      }

      skill.levelUps += 1;

      if (!isBelowTarget(skill.level, skill.targetLevel)) {
        skill.progress = 0;
        break;
      }

      needed = sessionsToNextMilestone(skill.level, age);
    }

    return leveledUp;
  }

  function remainingEffectiveTrainingsForSkill(skill, age, efficiency) {
    var clone = {
      level: skill.level,
      progress: skill.progress,
      levelUps: 0,
      targetLevel: skill.targetLevel,
    };
    var remaining = 0;

    if (efficiency <= 0) {
      return Infinity;
    }

    while (isBelowTarget(clone.level, clone.targetLevel)) {
      applyTraining(clone, age, efficiency);
      remaining += 1;
    }

    return remaining;
  }

  function createStrategy(strategyId) {
    var id = strategyId || 'priority';
    var roundRobinIndex = 0;

    function pickPriority(skills) {
      var i;

      for (i = 0; i < skills.length; i += 1) {
        if (isBelowTarget(skills[i].level, skills[i].targetLevel)) {
          return i;
        }
      }

      return null;
    }

    function pickRoundRobin(skills) {
      var active = getActiveSkillIndexes(skills);
      var pick;
      var i;

      if (!active.length) {
        return null;
      }

      for (i = 0; i < active.length; i += 1) {
        pick = active[(roundRobinIndex + i) % active.length];
        roundRobinIndex = (pick + 1) % active.length;
        return pick;
      }

      return null;
    }

    function pickCheapest(skills, age) {
      var active = getActiveSkillIndexes(skills);
      var bestIndex = null;
      var bestCost = Infinity;
      var i;
      var cost;

      active.forEach(function (index) {
        cost = sessionsToLevelUp(skills[index].level, age) - skills[index].progress;
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = index;
        }
      });

      return bestIndex;
    }

    function pickWeakest(skills) {
      var active = getActiveSkillIndexes(skills);
      var bestIndex = null;
      var bestLevel = Infinity;
      var i;

      active.forEach(function (index) {
        if (skills[index].level < bestLevel) {
          bestLevel = skills[index].level;
          bestIndex = index;
        }
      });

      return bestIndex;
    }

    return {
      id: id,
      reset: function () {
        roundRobinIndex = 0;
      },
      pick: function (skills, age) {
        if (id === 'roundRobin') {
          return pickRoundRobin(skills);
        }
        if (id === 'cheapest') {
          return pickCheapest(skills, age);
        }
        if (id === 'weakest') {
          return pickWeakest(skills);
        }
        return pickPriority(skills);
      },
    };
  }

  function simulate(input) {
    var age = Number(input.age);
    var daysLeftInSeason = Number(input.daysLeftInSeason);
    var seasonDays = Number(input.seasonDays) || CONFIG.seasonDays;
    var trainingPool = Number(input.trainingPool);
    var defaultTargetLevel = normalizeTargetLevel(input.targetLevel);
    var strategy = createStrategy(input.strategy);
    var seasons = getCareerSeasons(age, daysLeftInSeason, seasonDays);
    var skills = cloneSkills(input.skills || [], defaultTargetLevel);
    var juniorCount = normalizeJuniorCount(input.juniorCount);
    var trainingEfficiency = getJuniorTrainingEfficiency(juniorCount);
    var pool = Number.isFinite(trainingPool) ? Math.max(0, Math.min(CONFIG.poolCap, trainingPool)) : 0;
    var careerDays = getCareerDays(age, daysLeftInSeason, seasonDays);
    var budget = totalTrainingBudget(pool, careerDays);
    var effectiveBudget = budget * trainingEfficiency;
    var trainingsUsed = 0;
    var totalLevelUps = 0;
    var wastedPoints = 0;
    var seasonIndex;
    var dayIndex;
    var season;
    var skillIndex;

    strategy.reset();

    for (seasonIndex = 0; seasonIndex < seasons.length; seasonIndex += 1) {
      season = seasons[seasonIndex];

      for (dayIndex = 0; dayIndex < season.days; dayIndex += 1) {
        var beforeGain = pool;
        pool = Math.min(CONFIG.poolCap, pool + CONFIG.dailyGain);

        if (beforeGain >= CONFIG.poolCap) {
          wastedPoints += CONFIG.dailyGain;
        }

        while (pool > 0) {
          skillIndex = strategy.pick(skills, season.age);

          if (skillIndex === null) {
            if (pool >= CONFIG.poolCap) {
              wastedPoints += pool;
            }
            pool = 0;
            break;
          }

          skills[skillIndex].trainingsUsed += 1;

          totalLevelUps -= skills[skillIndex].levelUps;
          applyTraining(skills[skillIndex], season.age, trainingEfficiency);
          totalLevelUps += skills[skillIndex].levelUps;
          pool -= 1;
          trainingsUsed += 1;
        }
      }
    }

    var finalAge = seasons.length ? seasons[seasons.length - 1].age : age;

    return {
      strategy: strategy.id,
      age: age,
      finalAge: finalAge,
      careerDays: careerDays,
      budget: budget,
      effectiveBudget: effectiveBudget,
      juniorCount: juniorCount,
      trainingEfficiency: trainingEfficiency,
      trainingsUsed: trainingsUsed,
      totalLevelUps: totalLevelUps,
      wastedPoints: wastedPoints,
      skills: skills.map(function (skill) {
        var inputSkill = (input.skills || []).find(function (item) {
          return item.code === skill.code;
        });
        var remaining = isBelowTarget(skill.level, skill.targetLevel)
          ? remainingEffectiveTrainingsForSkill(skill, finalAge, trainingEfficiency)
          : 0;

        return {
          code: skill.code,
          startLevel: inputSkill ? inputSkill.level : null,
          level: skill.level,
          targetLevel: skill.targetLevel,
          reachedTarget: !isBelowTarget(skill.level, skill.targetLevel),
          remainingTrainingsToTarget: remaining,
          trainingsUsed: skill.trainingsUsed,
          levelUps: skill.levelUps,
        };
      }),
      allTargetsReached: skills.every(function (skill) {
        return !isBelowTarget(skill.level, skill.targetLevel);
      }),
    };
  }

  function compareStrategies(input, strategyIds) {
    var ids = strategyIds && strategyIds.length
      ? strategyIds
      : Object.keys(STRATEGY_META);

    return ids.map(function (strategyId) {
      return simulate(Object.assign({}, input, { strategy: strategyId }));
    });
  }

  return {
    CONFIG: CONFIG,
    STRATEGY_META: STRATEGY_META,
    sessionsToLevelUp: sessionsToLevelUp,
    sessionsToNextMilestone: sessionsToNextMilestone,
    fullSessionsForFinalBand: fullSessionsForFinalBand,
    isBelowTarget: isBelowTarget,
    normalizeJuniorCount: normalizeJuniorCount,
    getJuniorTrainingEfficiency: getJuniorTrainingEfficiency,
    getCareerSeasons: getCareerSeasons,
    getCareerDays: getCareerDays,
    totalTrainingBudget: totalTrainingBudget,
    trainingsRequiredForSkill: trainingsRequiredForSkill,
    simulate: simulate,
    compareStrategies: compareStrategies,
  };
}));
