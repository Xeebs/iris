# Context Audit Skill

When triggered (e.g., "audit my context response", "why is this query using so many tokens"), analyze the MCP context response for efficiency.

## Steps

1. **Token Budget Analysis**
   - Count tokens in the returned context
   - Identify the top 3 most token-heavy sections
   - Flag any sections exceeding 20% of the total budget

2. **Redundancy Detection**
   - Identify entities or attributes that appear more than once
   - Check if any relationship data is repeated across entities
   - Flag content that could be compressed with semantic deduplication

3. **Relevance Scoring**
   - For each context chunk, score relevance to the original query (0–1)
   - Flag chunks with score < 0.5 as candidates for removal
   - Estimate how many tokens could be saved by removing low-relevance chunks

4. **Cache Optimization**
   - Check if the system-level prefix (glossary, metric defs) is structured for cache hits
   - Recommend restructuring if dynamic content appears before static content

5. **Compression Recommendations**
   - Suggest which attributes could be omitted for this query type
   - Recommend summarization for long text attributes
   - Estimate total achievable token reduction

## Output Format

```
Context Audit Report
====================
Total tokens: X
Budget used: X%
Potential savings: X tokens (Y%)

Top Issues:
1. [issue] — [tokens wasted] — [fix]
2. ...

Recommendations:
- ...
```
